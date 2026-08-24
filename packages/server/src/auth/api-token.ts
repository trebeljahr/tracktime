// Personal API tokens — the auth path used by the Raycast and Chrome
// extensions (and any future scripting client).
//
// Security properties this module is responsible for:
//  - The plaintext token exists only in memory, exactly once, inside
//    `generateApiToken()`. It is never stored, never logged, never returned
//    by any read path.
//  - Only the SHA-256 hash of the FULL token string is persisted.
//  - `verifyApiToken()` never throws and never leaks *why* a token failed —
//    unknown, malformed, revoked and orphaned tokens are all just `null`.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { ApiToken } from "../models/ApiToken.js";
import { getAuth } from "./auth.js";

/** `tt_<prefix8>_<secret32>` */
const TOKEN_SCHEME = "tt";
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;

/** URL-safe, unambiguous in query strings and headers. */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Largest multiple of ALPHABET.length below 256 — used to reject biased bytes. */
const UNBIASED_CEILING = 256 - (256 % ALPHABET.length);

const TOKEN_PATTERN = new RegExp(
  `^${TOKEN_SCHEME}_([A-Za-z0-9]{${PREFIX_LENGTH}})_([A-Za-z0-9]{${SECRET_LENGTH}})$`,
);

/** `lastUsedAt` is refreshed at most once per minute, not once per request. */
const LAST_USED_THROTTLE_MS = 60_000;

/** A freshly minted token. `token` is the only copy of the plaintext. */
export type GeneratedApiToken = {
  /** Full plaintext value — return to the caller once, then forget it. */
  token: string;
  /** Short, non-secret identifier safe to show in listings. */
  prefix: string;
  /** SHA-256 (hex) of the full plaintext token — this is what gets stored. */
  tokenHash: string;
};

/** The better-auth `user` record shape, as consumed by tRPC/WS contexts. */
export type AuthUserRecord = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A synthetic stand-in for better-auth's `getSession()` envelope, so that a
 * token-authenticated request has the exact same `{ session, user }` shape as
 * a cookie-authenticated one.
 */
export type ApiTokenPrincipal = {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress: null;
    userAgent: null;
  };
  user: AuthUserRecord;
};

/** Cryptographically random string over {@link ALPHABET}, free of modulo bias. */
function randomAlphabetString(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte >= UNBIASED_CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** SHA-256 hex digest of the full plaintext token. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint a new personal API token. The returned `token` is the only copy of the
 * plaintext that will ever exist — persist `prefix` + `tokenHash` only.
 */
export function generateApiToken(): GeneratedApiToken {
  const prefix = randomAlphabetString(PREFIX_LENGTH);
  const secret = randomAlphabetString(SECRET_LENGTH);
  const token = `${TOKEN_SCHEME}_${prefix}_${secret}`;
  return { token, prefix, tokenHash: hashApiToken(token) };
}

/** Cheap shape test — lets callers skip work for values that cannot be tokens. */
export function looksLikeApiToken(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim());
}

/**
 * Pull a `tt_...` token out of an `Authorization: Bearer <token>` header.
 * Returns null for missing, malformed, or non-token credentials.
 */
export function extractBearerToken(
  header: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  if (!match) return null;
  const candidate = match[1];
  return looksLikeApiToken(candidate) ? candidate : null;
}

/** Constant-time hex-digest comparison; false on any length mismatch. */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Refresh `lastUsedAt`, but only when the stored value is older than
 * {@link LAST_USED_THROTTLE_MS}, so a hot client does not cause one write per
 * request. Fire-and-forget: a failed bookkeeping write never fails auth.
 */
function touchLastUsed(tokenHash: string, lastUsedAt: Date | null): void {
  const previous = lastUsedAt ? lastUsedAt.getTime() : 0;
  if (Date.now() - previous < LAST_USED_THROTTLE_MS) return;
  void ApiToken.updateOne({ tokenHash }, { $set: { lastUsedAt: new Date() } })
    .exec()
    .catch(() => {
      /* best-effort bookkeeping */
    });
}

/**
 * Verify a raw `tt_...` token and return its owner.
 *
 * Returns null for every failure mode — malformed, unknown, revoked — so the
 * caller can never distinguish "no such token" from "revoked token". Never
 * throws; a database outage degrades to "unauthenticated", not a 500.
 */
export async function verifyApiToken(
  raw: string,
): Promise<{ userId: string } | null> {
  try {
    const candidate = raw.trim();
    const parsed = TOKEN_PATTERN.exec(candidate);
    if (!parsed) return null;
    const prefix = parsed[1];

    const tokenHash = hashApiToken(candidate);
    const doc = await ApiToken.findOne({ tokenHash, prefix })
      .select("ownerId prefix tokenHash lastUsedAt revokedAt")
      .lean()
      .exec();
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (!digestsMatch(doc.tokenHash, tokenHash)) return null;

    touchLastUsed(tokenHash, doc.lastUsedAt);
    return { userId: doc.ownerId };
  } catch {
    return null;
  }
}

/** Narrow an unknown record coming out of better-auth into an AuthUserRecord. */
function normalizeAuthUser(value: unknown, userId: string): AuthUserRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const rawId = record.id ?? record._id;
  const id = rawId === undefined || rawId === null ? userId : String(rawId);
  if (!id) return null;
  const toDate = (input: unknown): Date =>
    input instanceof Date ? input : new Date();
  return {
    id,
    name: typeof record.name === "string" ? record.name : "",
    email: typeof record.email === "string" ? record.email : "",
    emailVerified: record.emailVerified === true,
    image: typeof record.image === "string" ? record.image : null,
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  };
}

/** Direct read of better-auth's `user` collection — fallback path only. */
async function findAuthUserInDb(userId: string): Promise<AuthUserRecord | null> {
  const db = mongoose.connection.db;
  if (!db) return null;
  const id: unknown = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const raw: unknown = await db
    .collection("user")
    .findOne({ _id: id } as Parameters<
      ReturnType<typeof db.collection>["findOne"]
    >[0]);
  return normalizeAuthUser(raw, userId);
}

/**
 * Load the better-auth user record for a token owner, so a token-authenticated
 * context carries the same `user` shape a cookie session would.
 */
async function findAuthUserById(userId: string): Promise<AuthUserRecord | null> {
  try {
    const auth: unknown = getAuth();
    const holder = auth as {
      $context?: Promise<{
        internalAdapter?: {
          findUserById?: (id: string) => Promise<unknown>;
        };
      }>;
    };
    if (holder.$context) {
      const authContext = await holder.$context;
      const found = await authContext?.internalAdapter?.findUserById?.(userId);
      const normalized = normalizeAuthUser(found, userId);
      if (normalized) return normalized;
    }
  } catch {
    // Fall through to the direct collection read below.
  }
  try {
    return await findAuthUserInDb(userId);
  } catch {
    return null;
  }
}

/**
 * Full token auth: verify the token, then resolve its owner into a
 * session-shaped principal. Returns null if the token is invalid/revoked *or*
 * if the owning user no longer exists (a deleted user must not stay reachable
 * through an old token).
 */
export async function resolveApiTokenPrincipal(
  raw: string,
): Promise<ApiTokenPrincipal | null> {
  const verified = await verifyApiToken(raw);
  if (!verified) return null;

  const user = await findAuthUserById(verified.userId);
  if (!user) return null;

  const now = new Date();
  return {
    session: {
      // Deliberately not a real session id and carries no secret material.
      id: `api-token:${verified.userId}`,
      userId: verified.userId,
      expiresAt: new Date(now.getTime() + LAST_USED_THROTTLE_MS),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user,
  };
}
