// Rate limiting for the public API: fixed windows, counted in Redis.
//
// Fixed window rather than a token bucket because it is INCR plus a
// first-write EXPIRE — two commands, no Lua script to keep in step with the
// deploy, and no stored clock to drift. The cost is the boundary burst (up to
// 2x the limit across two adjacent windows), which for an integration API is
// the right trade: the limit exists to stop a runaway loop, not to shape
// traffic to the millisecond.
//
// THREE counters, because one key can only defend against one thing:
//
//   - per TOKEN — the unit somebody can revoke and re-mint, so the unit whose
//     misbehaviour can be isolated. A user id would let one broken script
//     starve that person's other integrations.
//   - per WORKSPACE — because nothing stops a member from minting tokens, and
//     a limit keyed only on the token is a limit you defeat by round-robining
//     a hundred of them for a hundred times the budget. The token counter
//     alone is an accounting convenience, not a cap.
//   - per SOURCE ADDRESS **and presented token prefix**, on FAILED
//     authentication — the 401 path runs before any token is known to exist,
//     so it cannot be keyed on a token id. It is deliberately NOT keyed on the
//     address alone: that made one revoked cron's retries refuse every other
//     integration behind the same NAT, office or PaaS egress pool, and let
//     anyone who knew a victim shared an egress address burn the budget on
//     purpose. See `recordAuthFailure`.
import type { Response } from "express";
import { getRedis } from "../../db/redis.js";
import { env } from "../../config/env.js";

const WINDOW_MS = 60_000;
const KEY_PREFIX = "ratelimit:";

/**
 * How much more a whole workspace may spend than a single token.
 *
 * Not 1: a workspace legitimately runs several integrations at once, and a
 * shared budget equal to one token's would make any second integration a
 * cause of 429s for the first — the exact starvation that keying on the token
 * was meant to prevent. Not unbounded either, which is the bug this exists to
 * close. A small multiple keeps both properties: one runaway token still hits
 * its own ceiling first and leaves its siblings working, while minting tokens
 * buys a bounded amount of extra budget rather than a linear amount.
 */
const WORKSPACE_BURST_FACTOR = 4;

/**
 * The budget for requests that never authenticated, per failure key, per
 * minute.
 *
 * Deliberately small and NOT configurable alongside the authenticated limit:
 * nothing legitimate retries a rejected credential quickly. A human pasting a
 * mistyped token retries a handful of times; a script probing token prefixes
 * does not.
 */
const AUTH_FAILURE_PER_MINUTE = 30;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  resetSeconds: number;
};

/** What an authenticated request is counted against. */
export type RateLimitKey = {
  tokenId: string;
  workspaceId: string;
};

/**
 * The Redis-less fallback.
 *
 * A self-hoster running a single container with no Redis still gets a working
 * limit; the documented caveat is that it is then per PROCESS, so a two-replica
 * deployment without Redis effectively doubles it. Silently having no limit at
 * all would be worse — that is the configuration in which one runaway script
 * takes the database down.
 *
 * It is bounded in BOTH directions that matter: entries are dropped when the
 * window rolls over, and each store refuses to grow past a fixed number of
 * keys, falling open instead. A limiter that can be made to eat the heap is a
 * worse outage than the one it prevents.
 */
type MemoryWindow = { windowId: number; count: number };

type MemoryStore = {
  readonly entries: Map<string, MemoryWindow>;
  /**
   * Hard ceiling on how many distinct keys this store will ever hold. At the
   * ceiling a key that is not already present is NOT created and the caller
   * falls open, so the map cannot be grown without bound by whoever can reach
   * the endpoint.
   */
  readonly maxEntries: number;
  /** The window this store was last swept for. `-1` is "never". */
  sweptWindowId: number;
};

function createMemoryStore(maxEntries: number): MemoryStore {
  return { entries: new Map(), maxEntries, sweptWindowId: -1 };
}

/**
 * Authenticated counters, and failed-authentication counters, in SEPARATE
 * maps — not one shared map with one shared ceiling.
 *
 * Creating an authenticated key costs a valid token; creating a failure key
 * costs nothing but a socket. Sharing one map would let unauthenticated junk
 * fill it to the ceiling and thereby switch the authenticated limiter off for
 * the rest of the window — an unauthenticated caller disabling the control
 * that exists to stop runaway authenticated ones.
 *
 * The ceilings are entry counts, not bytes: ~50 bytes of key plus a two-number
 * object, so 30k entries is single-digit megabytes even when both are full.
 */
const authenticatedCounters = createMemoryStore(20_000);
const authFailureCounters = createMemoryStore(10_000);

/**
 * Swept on window ROLLOVER, not on write.
 *
 * A per-write sweep was O(n) over the whole map every time it passed a size
 * threshold, and deleted nothing while it did so — every entry shares the
 * current window id until the window ends. That turned each further request
 * into a linear scan of a map any unauthenticated caller could grow, so a
 * caller with an IPv6 /64 could make every request block the single-threaded
 * event loop for milliseconds and stall the whole server, not only /api/v1.
 *
 * Comparing against the last swept window makes the scan run once per minute
 * instead — O(1) amortised per write. Still no timer: a background interval
 * would keep the process alive in tests and is one more thing to `unref`.
 */
function sweepOnRollover(store: MemoryStore, windowId: number): void {
  if (store.sweptWindowId === windowId) return;
  store.sweptWindowId = windowId;
  for (const [key, entry] of store.entries) {
    if (entry.windowId !== windowId) store.entries.delete(key);
  }
}

/** Count one hit in memory, or `null` at the ceiling, which means fall open. */
function countInMemory(
  store: MemoryStore,
  key: string,
  windowId: number,
): number | null {
  sweepOnRollover(store, windowId);
  const existing = store.entries.get(key);
  if (existing) {
    // A stale entry is REUSED rather than replaced, so a key that survives a
    // rollover between sweeps cannot count against the ceiling twice.
    if (existing.windowId !== windowId) {
      existing.windowId = windowId;
      existing.count = 1;
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }
  if (store.entries.size >= store.maxEntries) return null;
  store.entries.set(key, { windowId, count: 1 });
  return 1;
}

/** Read a count. Deliberately never creates an entry — a read must not grow the map. */
function peekInMemory(store: MemoryStore, key: string, windowId: number): number {
  const existing = store.entries.get(key);
  return existing && existing.windowId === windowId ? existing.count : 0;
}

/** Test seam — the fallback counters are process-global state. */
export function resetInMemoryRateLimits(): void {
  for (const store of [authenticatedCounters, authFailureCounters]) {
    store.entries.clear();
    store.sweptWindowId = -1;
  }
}

/** Test seam — how many keys the fallback is currently holding. */
export function inMemoryRateLimitSize(): number {
  return authenticatedCounters.entries.size + authFailureCounters.entries.size;
}

/**
 * Count one hit against a window, or `null` when it could not be counted —
 * Redis unreachable, or the in-memory fallback at its entry ceiling.
 *
 * `null` means FALL OPEN, and every caller treats it that way: the limiter is
 * a safeguard against runaway callers, and turning a Redis blip into a 429
 * storm across every integration would be a far larger outage than the one it
 * is guarding. A full fallback map is the same argument — running out of room
 * to count must not become a refusal.
 */
async function bumpWindow(
  store: MemoryStore,
  key: string,
  windowId: number,
): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return countInMemory(store, key, windowId);
  try {
    const full = `${KEY_PREFIX}${key}:${windowId}`;
    const count = await redis.incr(full);
    // Only the first write sets the TTL. Re-issuing EXPIRE on every request
    // would slide the window forward forever and the key would never drop.
    if (count === 1) await redis.expire(full, Math.ceil(WINDOW_MS / 1000));
    return count;
  } catch {
    return null;
  }
}

/** Read a window's count WITHOUT charging for it. `null` means fall open. */
async function readWindow(
  store: MemoryStore,
  key: string,
  windowId: number,
): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return peekInMemory(store, key, windowId);
  try {
    const raw = await redis.get(`${KEY_PREFIX}${key}:${windowId}`);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return null;
  }
}

function windowIdAt(now: number): number {
  return Math.floor(now / WINDOW_MS);
}

function resetSecondsAt(now: number): number {
  return Math.ceil(((windowIdAt(now) + 1) * WINDOW_MS - now) / 1000);
}

function resultFor(
  count: number | null,
  limit: number,
  resetSeconds: number,
): RateLimitResult {
  if (count === null) return { allowed: true, limit, remaining: limit, resetSeconds };
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds,
  };
}

/**
 * The same, for a counter READ rather than charged.
 *
 * `<` and not `<=`, because `count` here is what has already been spent and
 * the request being judged has not been charged yet — it will be only if it
 * too fails. Reusing the charged form would grant one extra failure per
 * window, which is a harmless off-by-one to state plainly rather than a
 * subtlety to leave for the next reader to rediscover.
 */
function budgetLeft(
  count: number | null,
  limit: number,
  resetSeconds: number,
): RateLimitResult {
  if (count === null) return { allowed: true, limit, remaining: limit, resetSeconds };
  return {
    allowed: count < limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds,
  };
}

/**
 * The budget a client should be told about when two apply.
 *
 * The TIGHTER one, so `RateLimit-Remaining` names the constraint that will
 * actually refuse the next request. Advertising the looser one would have a
 * well-behaved client pace itself against a budget it does not have and get
 * 429s it was told to expect none of.
 */
function tighter(a: RateLimitResult, b: RateLimitResult): RateLimitResult {
  const binding = b.remaining < a.remaining ? b : a;
  return { ...binding, allowed: a.allowed && b.allowed };
}

/**
 * Count one authenticated request, against its token AND its workspace.
 *
 * Both counters are charged on every request — not the workspace one only
 * once the token's is exhausted — because a short-circuit would let the
 * hundred-token round robin spend a hundred token budgets before the
 * workspace counter had seen a single request.
 */
export async function consumeRateLimit(
  key: RateLimitKey,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const tokenLimit = env.API_RATE_LIMIT_PER_MINUTE;
  const workspaceLimit = tokenLimit * WORKSPACE_BURST_FACTOR;
  const windowId = windowIdAt(now);
  const resetSeconds = resetSecondsAt(now);

  const [tokenCount, workspaceCount] = await Promise.all([
    bumpWindow(authenticatedCounters, `apitoken:${key.tokenId}`, windowId),
    bumpWindow(authenticatedCounters, `workspace:${key.workspaceId}`, windowId),
  ]);

  return tighter(
    resultFor(tokenCount, tokenLimit, resetSeconds),
    resultFor(workspaceCount, workspaceLimit, resetSeconds),
  );
}

/**
 * Has this failure key already burned its budget of failed authentications?
 *
 * `key` is the caller's own composite — see `authFailureKey` in `auth.ts`,
 * which builds it from the source address AND the token prefix that was
 * presented. This function never sees an address on its own, and that is the
 * point: keyed on the address alone, thirty rejected requests refused every
 * OTHER credential arriving from the same NAT, office, CI runner or PaaS
 * egress pool for the rest of the window, including valid ones. Scoping the
 * key to the presented credential means only the credential that failed is
 * rationed.
 *
 * READ-only, and called BEFORE the token lookup — that ordering is what buys
 * anything. `authenticateApiToken` costs an indexed `ApiToken.findOne` per
 * call, and a well-formed but bogus `Authorization: Bearer tt_AAAAAAAA_<43
 * chars>` reaches it without any credential existing. Metering only after a
 * successful authentication leaves the failure path unmetered, which is the
 * cheap half of the API to abuse.
 *
 * It buys less than an address-keyed gate would: a caller who varies the
 * prefix on every request gets a fresh key each time and is not gated at all.
 * That is the deliberate trade. This meter stops a credential that keeps being
 * re-presented — a revoked token's cron, a mistyped one in a script — and
 * general flood control belongs in front of the process, not in a counter that
 * can refuse somebody else's working integration.
 */
export async function checkAuthFailureBudget(
  key: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const count = await readWindow(
    authFailureCounters,
    `authfail:${key}`,
    windowIdAt(now),
  );
  return budgetLeft(count, AUTH_FAILURE_PER_MINUTE, resetSecondsAt(now));
}

/** Charge one failed authentication to a failure key. */
export async function recordAuthFailure(
  key: string,
  now: number = Date.now(),
): Promise<void> {
  await bumpWindow(authFailureCounters, `authfail:${key}`, windowIdAt(now));
}

/**
 * The `RateLimit-*` headers, on every authenticated response.
 *
 * On every response, not only on a 429: a client that can only discover its
 * budget by being refused has to hit the wall to learn where it is.
 */
export function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  res.setHeader("RateLimit-Reset", String(result.resetSeconds));
}
