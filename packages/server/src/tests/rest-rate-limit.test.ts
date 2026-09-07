// The API rate limiter, on its Redis-less path.
//
// That path is the one a self-hoster runs, and it is the one that fails
// quietly: a counter that never resets locks an integration out permanently,
// and a counter that resets on every call is no limit at all. Both look
// identical from the outside until somebody is either throttled forever or
// not throttled at all.
//
// The limit is set here BEFORE the module is imported, because `config/env.ts`
// reads process.env once at load. node:test gives each file its own process,
// so this cannot leak into another test's expectations.
process.env.API_RATE_LIMIT_PER_MINUTE = "3";
// Deliberately unusable. `req.ip` is what the failed-authentication meter is
// keyed on, so a hop count that silently became NaN would set `trust proxy` to
// NaN and take the key with it — the same parsing hole as a NaN rate limit,
// one variable over.
process.env.TRUST_PROXY_HOPS = "1 hop";

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { Response } from "express";

const {
  checkAuthFailureBudget,
  consumeRateLimit,
  inMemoryRateLimitSize,
  recordAuthFailure,
  resetInMemoryRateLimits,
  setRateLimitHeaders,
} = await import("../api/v1/rate-limit.js");
const { authFailureKey } = await import("../api/v1/auth.js");
const { env } = await import("../config/env.js");

const LIMIT = 3;
/** Mirrors `WORKSPACE_BURST_FACTOR` in the limiter. */
const WORKSPACE_LIMIT = LIMIT * 4;
/** An instant 12s into a window, so the reset is a round 48s. */
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % 60_000) + 12_000;

/** A well-formed `Authorization` value for a token with this prefix. */
const bearerWithPrefix = (prefix: string): string =>
  `Bearer tt_${prefix}_${"a".repeat(43)}`;

/** A key for a token that is the only one in its workspace. */
const soleToken = (tokenId: string): { tokenId: string; workspaceId: string } => ({
  tokenId,
  workspaceId: `ws-of-${tokenId}`,
});

beforeEach(() => {
  resetInMemoryRateLimits();
});

describe("consumeRateLimit", () => {
  it("allows exactly the limit, then refuses", async () => {
    for (let i = 1; i <= LIMIT; i += 1) {
      const result = await consumeRateLimit(soleToken("token-a"), T0);
      assert.equal(result.allowed, true, `request ${i}`);
      assert.equal(result.remaining, LIMIT - i, `request ${i}`);
    }
    const refused = await consumeRateLimit(soleToken("token-a"), T0);
    assert.equal(refused.allowed, false);
    assert.equal(refused.remaining, 0);
  });

  it("floors `remaining` at zero however far over the caller runs", async () => {
    // A negative `remaining` in the header is what makes a client's own
    // backoff arithmetic produce a negative sleep and hammer the endpoint.
    for (let i = 0; i < LIMIT + 25; i += 1) {
      await consumeRateLimit(soleToken("token-b"), T0);
    }
    const result = await consumeRateLimit(soleToken("token-b"), T0);
    assert.equal(result.remaining, 0);
    assert.equal(result.allowed, false);
  });

  it("gives each token its own budget", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      await consumeRateLimit(soleToken("token-c"), T0);
    }
    // One token's runaway loop must not lock out its owner's other
    // integrations — which is why the counter is keyed on the token and not
    // on the user or the source IP.
    const other = await consumeRateLimit(soleToken("token-d"), T0);
    assert.equal(other.allowed, true);
    assert.equal(other.remaining, LIMIT - 1);
  });

  it("starts a fresh budget in the next window", async () => {
    for (let i = 0; i < LIMIT + 1; i += 1) {
      await consumeRateLimit(soleToken("token-e"), T0);
    }
    const next = await consumeRateLimit(soleToken("token-e"), T0 + 60_000);
    assert.equal(next.allowed, true);
    assert.equal(next.remaining, LIMIT - 1);
  });

  it("reports seconds until the window rolls, never a wall-clock time", async () => {
    const result = await consumeRateLimit(soleToken("token-f"), T0);
    assert.equal(result.resetSeconds, 48);
    // Always in (0, 60]: a zero would tell a client to retry immediately into
    // the same exhausted window.
    for (const offset of [0, 1, 30_000, 59_999]) {
      const at = await consumeRateLimit(
        soleToken(`token-g-${offset}`),
        T0 - 12_000 + offset,
      );
      assert.ok(at.resetSeconds > 0 && at.resetSeconds <= 60, String(offset));
    }
  });

  it("reports the configured limit so a client can read its own budget", async () => {
    const result = await consumeRateLimit(soleToken("token-h"), T0);
    assert.equal(result.limit, LIMIT);
  });
});

describe("the workspace budget", () => {
  it("is shared by every token in the workspace", async () => {
    // Nothing stops a member from minting more tokens, so a limit keyed only
    // on the token is one you defeat by round-robining a hundred of them for
    // a hundred times the budget. Fresh tokens must keep spending the same
    // workspace budget.
    let spent = 0;
    for (let n = 0; spent < WORKSPACE_LIMIT; n += 1) {
      for (let i = 0; i < LIMIT && spent < WORKSPACE_LIMIT; i += 1) {
        const result = await consumeRateLimit(
          { tokenId: `rotating-${n}`, workspaceId: "ws-rotator" },
          T0,
        );
        assert.equal(result.allowed, true, `request ${spent + 1}`);
        spent += 1;
      }
    }

    const refused = await consumeRateLimit(
      { tokenId: "rotating-brand-new", workspaceId: "ws-rotator" },
      T0,
    );
    assert.equal(refused.allowed, false);
    assert.equal(refused.remaining, 0);
    assert.equal(refused.limit, WORKSPACE_LIMIT);
  });

  it("is bigger than one token's, so a second integration is not punished", async () => {
    // Sharing a budget EQUAL to one token's would make any second integration
    // a cause of 429s for the first — the starvation that keying on the token
    // was meant to prevent.
    for (let i = 0; i < LIMIT; i += 1) {
      await consumeRateLimit({ tokenId: "busy", workspaceId: "ws-pair" }, T0);
    }
    const sibling = await consumeRateLimit(
      { tokenId: "quiet", workspaceId: "ws-pair" },
      T0,
    );
    assert.equal(sibling.allowed, true);
    assert.equal(sibling.remaining, LIMIT - 1);
  });

  it("does not leak across workspaces", async () => {
    for (let i = 0; i < WORKSPACE_LIMIT + 5; i += 1) {
      await consumeRateLimit(
        { tokenId: `noisy-${i}`, workspaceId: "ws-noisy" },
        T0,
      );
    }
    const elsewhere = await consumeRateLimit(
      { tokenId: "innocent", workspaceId: "ws-quiet" },
      T0,
    );
    assert.equal(elsewhere.allowed, true);
    assert.equal(elsewhere.remaining, LIMIT - 1);
  });

  it("reports the tighter of the two budgets", async () => {
    // The header must name the constraint that will actually refuse the next
    // request; advertising the looser one has a well-behaved client pace
    // itself against a budget it does not have.
    for (let i = 0; i < WORKSPACE_LIMIT - 1; i += 1) {
      await consumeRateLimit(
        { tokenId: `spender-${i}`, workspaceId: "ws-tight" },
        T0,
      );
    }
    const last = await consumeRateLimit(
      { tokenId: "fresh", workspaceId: "ws-tight" },
      T0,
    );
    assert.equal(last.allowed, true);
    assert.equal(last.limit, WORKSPACE_LIMIT);
    assert.equal(last.remaining, 0);
  });
});

describe("the failed-authentication key", () => {
  it("names the credential that was presented, not only where it came from", () => {
    // Keyed on the address alone this meter was a denial primitive: thirty
    // rejected requests — one customer's revoked token, retried by its cron —
    // refused every OTHER integration behind that egress address, and anyone
    // who knew a victim shared one could burn the budget on purpose.
    assert.equal(
      authFailureKey("198.51.100.7", bearerWithPrefix("AAAAAAAA")),
      "198.51.100.7:AAAAAAAA",
    );
  });

  it("falls back to the bare address when there is no parseable token", () => {
    // Those cost no database lookup, so there is nothing to protect — but they
    // must not share a key with a real credential from the same address, or
    // the denial primitive comes straight back through junk traffic.
    for (const header of [undefined, "", "Bearer not-a-token", "Basic abc"]) {
      assert.equal(authFailureKey("198.51.100.7", header), "198.51.100.7");
    }
    assert.notEqual(
      authFailureKey("198.51.100.7", undefined),
      authFailureKey("198.51.100.7", bearerWithPrefix("AAAAAAAA")),
    );
  });
});

describe("the failed-authentication budget", () => {
  const address = "198.51.100.7";
  const badCredential = authFailureKey(address, bearerWithPrefix("BADBADBA"));
  const goodCredential = authFailureKey(address, bearerWithPrefix("G00DG00D"));

  it("is not spent by merely asking", async () => {
    // The check runs BEFORE the token lookup on every request, including the
    // ones that go on to authenticate. If reading it charged for it, a valid
    // token would lock itself out.
    for (let i = 0; i < 100; i += 1) {
      await checkAuthFailureBudget(goodCredential, T0);
    }
    const budget = await checkAuthFailureBudget(goodCredential, T0);
    assert.equal(budget.allowed, true);
    assert.equal(budget.remaining, budget.limit);
  });

  it("refuses a credential that keeps failing", async () => {
    // Unmetered, a well-formed but bogus `Bearer tt_…` costs one indexed
    // ApiToken.findOne per request at whatever rate the caller likes.
    const budget = await checkAuthFailureBudget(badCredential, T0);
    for (let i = 0; i < budget.limit; i += 1) {
      await recordAuthFailure(badCredential, T0);
    }
    const blocked = await checkAuthFailureBudget(badCredential, T0);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("still serves a valid token from an address that has accumulated failures", async () => {
    // The regression this exists for. One revoked token retried from an office
    // NAT — or an attacker deliberately burning bogus Bearer values from an
    // address they know the victim shares — must not refuse anybody else's
    // working integration.
    for (let i = 0; i < 200; i += 1) await recordAuthFailure(badCredential, T0);
    for (let i = 0; i < 200; i += 1) await recordAuthFailure(address, T0);

    const valid = await checkAuthFailureBudget(goodCredential, T0);
    assert.equal(valid.allowed, true);
    assert.equal(valid.remaining, valid.limit);
  });

  it("keys on the address too, so one prober cannot lock everyone out", async () => {
    for (let i = 0; i < 200; i += 1) await recordAuthFailure(badCredential, T0);
    const elsewhere = await checkAuthFailureBudget(
      authFailureKey("203.0.113.4", bearerWithPrefix("BADBADBA")),
      T0,
    );
    assert.equal(elsewhere.allowed, true);
  });

  it("clears in the next window", async () => {
    for (let i = 0; i < 200; i += 1) await recordAuthFailure(badCredential, T0);
    const next = await checkAuthFailureBudget(badCredential, T0 + 60_000);
    assert.equal(next.allowed, true);
  });
});

describe("the Redis-less fallback map", () => {
  /** Milliseconds to charge `writes` failures across four already-present keys. */
  const timeWrites = async (prefix: string, writes: number): Promise<number> => {
    const started = process.hrtime.bigint();
    for (let i = 0; i < writes; i += 1) {
      await recordAuthFailure(`${prefix}:${i % 4}`, T0);
    }
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  it("does not get slower as it fills", async () => {
    // It used to: the sweep ran O(n) over the whole map on every write past
    // 512 entries while deleting nothing, because every entry shares the
    // current window id until the window ends. A caller with an IPv6 /64 could
    // therefore make each further request block the single-threaded event loop
    // for milliseconds and stall the whole server, not only /api/v1.
    const baseline = await timeWrites("baseline", 2_000);

    for (let i = 0; i < 8_000; i += 1) {
      await recordAuthFailure(`filler-${i}`, T0);
    }
    const loaded = await timeWrites("loaded", 2_000);

    assert.ok(
      loaded <= Math.max(baseline * 25, 5),
      `2,000 writes cost ${loaded.toFixed(1)}ms with 8,000 keys resident vs ${baseline.toFixed(1)}ms empty — the per-write cost is growing with the map`,
    );
  });

  it("stops growing at a ceiling instead of eating the heap", async () => {
    for (let i = 0; i < 40_000; i += 1) {
      await recordAuthFailure(`flood-${i}`, T0);
    }
    const size = inMemoryRateLimitSize();
    assert.ok(size <= 10_000, `fallback map holds ${size} keys`);
  });

  it("falls open rather than refusing once it is full", async () => {
    // Full, a key that was never stored reads as zero spent. Falling open is
    // the deliberate choice: a limiter that starts refusing when it is out of
    // room turns memory pressure into an outage for everyone.
    for (let i = 0; i < 40_000; i += 1) {
      await recordAuthFailure(`flood-${i}`, T0);
    }
    const latecomer = authFailureKey("203.0.113.9", bearerWithPrefix("LATELATE"));
    for (let i = 0; i < 200; i += 1) await recordAuthFailure(latecomer, T0);
    const budget = await checkAuthFailureBudget(latecomer, T0);
    assert.equal(budget.allowed, true);
  });

  it("keeps unauthenticated junk out of the authenticated counters", async () => {
    // Separate maps, so filling the failure store — which costs nothing but a
    // socket — cannot switch off the limiter that stops runaway AUTHENTICATED
    // callers, which is the one that protects the database.
    for (let i = 0; i < 40_000; i += 1) {
      await recordAuthFailure(`flood-${i}`, T0);
    }
    for (let i = 0; i < LIMIT; i += 1) {
      const allowed = await consumeRateLimit(soleToken("token-j"), T0);
      assert.equal(allowed.allowed, true);
    }
    const refused = await consumeRateLimit(soleToken("token-j"), T0);
    assert.equal(refused.allowed, false);
  });

  it("drops the previous window's keys when the window rolls", async () => {
    for (let i = 0; i < 600; i += 1) await recordAuthFailure(`stale-${i}`, T0);
    assert.equal(inMemoryRateLimitSize(), 600);

    await recordAuthFailure("fresh", T0 + 60_000);
    assert.equal(inMemoryRateLimitSize(), 1);
  });
});

describe("TRUST_PROXY_HOPS", () => {
  it("falls back to one hop rather than NaN when the value is unusable", () => {
    // Set to "1 hop" at the top of this file. `app.set("trust proxy", NaN)`
    // makes Express resolve `req.ip` from a header nobody validated, and the
    // failed-authentication meter is keyed on `req.ip` — so the bad parse
    // would not error anywhere, it would just quietly stop metering.
    assert.equal(env.TRUST_PROXY_HOPS, 1);
  });
});

describe("setRateLimitHeaders", () => {
  it("writes the three headers on an ordinary success too", async () => {
    // Not only on a 429: a client that can only discover its budget by being
    // refused has to hit the wall to learn where it is.
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    } as unknown as Response;

    setRateLimitHeaders(res, await consumeRateLimit(soleToken("token-i"), T0));
    assert.deepEqual(headers, {
      "RateLimit-Limit": "3",
      "RateLimit-Remaining": "2",
      "RateLimit-Reset": "48",
    });
  });
});
