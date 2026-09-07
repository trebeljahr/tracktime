// What an UNUSABLE `API_RATE_LIMIT_PER_MINUTE` does.
//
// Its own file because `config/env.ts` reads process.env once, at load, so a
// bad value has to be in place before the first import — and node:test gives
// each file its own process, so this cannot leak into the sibling file that
// pins the limiter's arithmetic.
//
// The failure being pinned is not cosmetic. `parseInt("")` is NaN, every
// comparison against NaN is false, and the limiter's verdict is
// `count <= limit` — so a blank value in a hosting panel's env editor refuses
// the FIRST request of every window and advertises `RateLimit-Limit: NaN`.
// One stray character takes the whole public API down while looking exactly
// like a limiter doing its job.
//
// `"60 0"` rather than `""` because it fails BOTH ways at once: `parseInt`
// reads it as 60 (a silently wrong limit, ten times too strict) and `Number`
// reads it as NaN (the outage above). Only a validated fallback answers 600.
process.env.API_RATE_LIMIT_PER_MINUTE = "60 0";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { env } = await import("../config/env.js");
const { consumeRateLimit } = await import("../api/v1/rate-limit.js");

const DEFAULT_LIMIT = 600;

describe("an unusable API_RATE_LIMIT_PER_MINUTE", () => {
  it("falls back to the default rather than to NaN or to a prefix of itself", () => {
    assert.equal(env.API_RATE_LIMIT_PER_MINUTE, DEFAULT_LIMIT);
  });

  it("leaves the limiter serving requests", async () => {
    const result = await consumeRateLimit({
      tokenId: "token-config",
      workspaceId: "ws-config",
    });

    assert.equal(result.allowed, true, "a NaN limit refuses the first request");
    assert.equal(result.limit, DEFAULT_LIMIT);
    assert.equal(result.remaining, DEFAULT_LIMIT - 1);
  });
});
