import assert from "node:assert/strict";
import test from "node:test";
import { env, getTrustedOrigins } from "../config/env.js";

// These assert the contract of getTrustedOrigins() against whatever env is
// actually loaded, rather than a hardcoded localhost port — this project's
// dev ports are assigned by scripts/dev.mjs, so a literal port here fails
// for reasons that have nothing to do with the code under test.

test("trusted origins lead with the configured frontend URL", () => {
  const origins = getTrustedOrigins();
  assert.ok(Array.isArray(origins));

  if (env.FRONTEND_URL) {
    assert.equal(origins[0], env.FRONTEND_URL);
  } else {
    assert.deepEqual(origins, []);
  }
});

test("trusted origins merge in the TRUSTED_ORIGINS csv", () => {
  const extras = env.TRUSTED_ORIGINS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const origins = getTrustedOrigins();
  for (const extra of extras) {
    assert.ok(
      origins.includes(extra),
      `expected trusted origins to include ${extra}`,
    );
  }
});
