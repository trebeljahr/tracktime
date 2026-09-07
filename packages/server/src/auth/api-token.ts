// The API-token credential: how one is made, how one is checked, and what a
// checked one is allowed to see.
//
// This is deliberately NOT a better-auth session and never becomes one. A
// session belongs to a person and follows them into every workspace they are
// in; a token is bound to ONE workspace and to a visibility ceiling fixed at
// mint time. Keeping them separate is what makes "a token can never see more
// than its owner" a property of the type rather than of a code review.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { ApiTokenScope, Visibility, VisibilityGrant } from "@starter/shared";
import { narrowVisibility } from "@starter/shared";
import { ApiToken } from "../models/ApiToken.js";
import {
  visibilityOf,
  type WorkspaceMemberDocLike,
} from "../models/WorkspaceMember.js";
import { resolveWorkspace } from "./workspace.js";

/** `tt_` + 8-char prefix + `_` + 43-char secret. */
const TOKEN_SCHEME = "tt_";
/** 6 random bytes → 8 base64url chars. Non-secret; it only selects a row. */
const PREFIX_BYTES = 6;
const PREFIX_CHARS = 8;
/** 32 random bytes → 43 base64url chars. This is the whole secret. */
const SECRET_BYTES = 32;
const SECRET_CHARS = 43;
const TOKEN_LENGTH =
  TOKEN_SCHEME.length + PREFIX_CHARS + 1 + SECRET_CHARS;

/** sha256 is 32 bytes; both sides of the comparison are always this long. */
const HASH_BYTES = 32;

/**
 * How often a token's `lastUsedAt` may be rewritten.
 *
 * A write per request would make this the hottest collection in the database
 * for the sake of a field nobody reads more precisely than "today". One write
 * a minute per token keeps the settings screen honest and the write path free.
 */
export const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Hash the WHOLE plaintext, prefix included.
 *
 * sha256 rather than Argon2/bcrypt on purpose. Those exist to slow a
 * dictionary attack down against something a human chose; this is 256 bits
 * out of a CSPRNG, so there is no dictionary and nothing to slow down — a
 * per-request KDF would only add ~100ms to every single API call in exchange
 * for nothing.
 *
 * Covering the prefix as well as the secret means a leaked prefix cannot be
 * re-paired with a guessed secret and still match a hash computed over the
 * secret alone.
 */
export function hashApiToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Mint a fresh token. The plaintext is returned once and never stored. */
export function mintApiToken(): {
  plaintext: string;
  prefix: string;
  tokenHash: string;
} {
  const prefix = randomBytes(PREFIX_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const plaintext = `${TOKEN_SCHEME}${prefix}_${secret}`;
  return { plaintext, prefix, tokenHash: hashApiToken(plaintext) };
}

/**
 * Pull the lookup prefix off a presented token, or null when it cannot be one.
 *
 * Parsed by POSITION rather than by splitting on `_`: base64url includes `_`,
 * so a prefix or secret containing one would make a split-based parse address
 * the wrong row (or none) for a perfectly valid token.
 */
export function parseApiToken(raw: string): { prefix: string } | null {
  if (raw.length !== TOKEN_LENGTH) return null;
  if (!raw.startsWith(TOKEN_SCHEME)) return null;
  if (raw[TOKEN_SCHEME.length + PREFIX_CHARS] !== "_") return null;

  const prefix = raw.slice(TOKEN_SCHEME.length, TOKEN_SCHEME.length + PREFIX_CHARS);
  const secret = raw.slice(TOKEN_SCHEME.length + PREFIX_CHARS + 1);
  const base64url = /^[A-Za-z0-9_-]+$/;
  if (!base64url.test(prefix) || !base64url.test(secret)) return null;
  return { prefix };
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 *
 * Both operands are a sha256 digest, so their length is a constant of the
 * algorithm — the length check here is an assertion about a corrupt stored
 * value, not a branch on caller-controlled data, and it must come first
 * because `timingSafeEqual` throws on a length mismatch.
 */
export function verifyApiToken(plaintext: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiToken(plaintext), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (presented.length !== HASH_BYTES || stored.length !== HASH_BYTES) {
    return false;
  }
  return timingSafeEqual(presented, stored);
}

/**
 * Does this token carry the scope a route requires?
 *
 * Deny-by-default is a property of THIS function, never of a default value:
 * it asks whether the scope is present, so a token with no scopes at all
 * passes nothing. A `scopes ?? ALL_SCOPES` fallback anywhere would invert
 * that, silently, for every row written before the field existed.
 *
 * `entries:write` deliberately does NOT imply `entries:read`. An implication
 * is the kind of rule a reviewer stops re-checking after the second time.
 */
export function hasScope(
  scopes: readonly ApiTokenScope[] | null | undefined,
  required: ApiTokenScope,
): boolean {
  return (scopes ?? []).includes(required);
}

/** A successfully authenticated token, resolved against live membership. */
export type ApiTokenAuth = {
  tokenId: string;
  workspaceId: string;
  userId: string;
  scopes: ApiTokenScope[];
  /** Live membership visibility, ANDed with the token's mint-time ceiling. */
  visibility: Visibility;
  membership: WorkspaceMemberDocLike;
};

/**
 * Why a token was refused.
 *
 * Every one of these answers 401 to the caller — the distinctions exist for
 * logs and for the docs, never for the response body. Telling an attacker
 * apart "no such token" from "wrong secret" is how a prefix becomes an oracle.
 */
export type ApiTokenFailure = {
  error: "missing" | "malformed" | "unknown" | "revoked" | "expired" | "no_membership";
};

const isFailure = (
  value: ApiTokenAuth | ApiTokenFailure,
): value is ApiTokenFailure => "error" in value;

/** Narrowing helper, so callers do not re-derive the discriminant. */
export function isApiTokenAuth(
  value: ApiTokenAuth | ApiTokenFailure,
): value is ApiTokenAuth {
  return !isFailure(value);
}

/**
 * Record that a token was used, at most once per throttle window.
 *
 * Unawaited and self-swallowing: `lastUsedAt` is diagnostics, and a write
 * failure must never turn a valid request into a 500. The `$lt` in the FILTER
 * is what makes the throttle correct under concurrency — two simultaneous
 * requests race on the same condition and exactly one write lands.
 */
function touchLastUsed(tokenId: string, now: Date): void {
  const cutoff = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
  void ApiToken.updateOne(
    {
      _id: tokenId,
      $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: cutoff } }],
    },
    { $set: { lastUsedAt: now } },
  ).catch(() => {
    // Diagnostics only — never fail a request over it.
  });
}

/**
 * Authenticate an `Authorization: Bearer <token>` header value.
 *
 * The visibility this returns is LIVE, intersected with the ceiling the token
 * was minted under. See `narrowVisibility` for why neither half alone is
 * safe. A member who has been removed from the workspace makes the token dead
 * (401), not merely unauthorized (403): there is nothing left for it to act
 * as, and 403 would confirm the workspace exists.
 */
export async function authenticateApiToken(
  authorizationHeader: string | undefined,
): Promise<ApiTokenAuth | ApiTokenFailure> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader ?? "");
  if (!match || !match[1]) return { error: "missing" };
  const presented = match[1];

  const parsed = parseApiToken(presented);
  if (!parsed) return { error: "malformed" };

  // Indexed single-document read, never a scan: the prefix is unique and
  // non-secret precisely so that finding the row costs one lookup and the
  // secret is only ever compared in constant time, once.
  const doc = await ApiToken.findOne({ prefix: parsed.prefix }).lean();
  // A prefix nobody has and a prefix whose secret is wrong take the same exit.
  if (!doc || !verifyApiToken(presented, doc.tokenHash)) {
    return { error: "unknown" };
  }

  if (doc.revokedAt) return { error: "revoked" };
  const now = new Date();
  if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) {
    return { error: "expired" };
  }

  // `requested` is the token's own workspace and nothing else — a token
  // request never reaches `workspaceIdFromInput`, so there is no input a
  // caller could put a foreign workspace id on.
  const resolved = await resolveWorkspace({
    user: { id: doc.userId },
    requested: doc.workspaceId,
    activeWorkspaceId: null,
  });
  if (!resolved) return { error: "no_membership" };

  const ceiling: VisibilityGrant = {
    canViewOthersTime: doc.grantedVisibility?.canViewOthersTime ?? false,
    canViewOthersMoney: doc.grantedVisibility?.canViewOthersMoney ?? false,
  };

  const tokenId = String(doc._id);
  touchLastUsed(tokenId, now);

  return {
    tokenId,
    workspaceId: resolved.workspaceId,
    userId: doc.userId,
    scopes: doc.scopes ?? [],
    visibility: narrowVisibility(visibilityOf(resolved.membership), ceiling),
    membership: resolved.membership,
  };
}
