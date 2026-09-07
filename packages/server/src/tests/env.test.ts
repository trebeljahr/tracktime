import assert from "node:assert/strict";
import test from "node:test";
import { env, getTrustedOrigins, resolveAppUrls } from "../config/env.js";

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

// APP_URL is the single-domain shortcut: one URL that supplies both of the
// two the split hosted deploy sets separately. resolveAppUrls takes nodeEnv
// as an argument rather than reading process.env, so the production-only
// throw can be asserted without mutating the environment the other tests run
// against.
const APP = "https://track.example.com";
const WEB = "https://tracktime.example.com";
const API = "https://api.tracktime.example.com";

test("APP_URL alone supplies both auth URLs", () => {
  const resolved = resolveAppUrls(
    { appUrl: APP, frontendUrl: "", betterAuthUrl: "" },
    "production",
  );
  assert.equal(resolved.frontendUrl, APP);
  assert.equal(resolved.betterAuthUrl, APP);
});

test("APP_URL loses its trailing slash", () => {
  const resolved = resolveAppUrls(
    { appUrl: `${APP}//`, frontendUrl: "", betterAuthUrl: "" },
    "production",
  );
  assert.equal(resolved.frontendUrl, APP);
  assert.equal(resolved.betterAuthUrl, APP);
});

test("explicit URLs work with no APP_URL, and may differ from each other", () => {
  const resolved = resolveAppUrls(
    { appUrl: "", frontendUrl: WEB, betterAuthUrl: API },
    "production",
  );
  assert.equal(resolved.frontendUrl, WEB);
  assert.equal(resolved.betterAuthUrl, API);
});

test("explicit URLs win over APP_URL", () => {
  // The hosted deploy sets both to two different hosts. Whatever APP_URL says,
  // that split must survive untouched.
  const resolved = resolveAppUrls(
    { appUrl: APP, frontendUrl: WEB, betterAuthUrl: API },
    "production",
  );
  assert.equal(resolved.frontendUrl, WEB);
  assert.equal(resolved.betterAuthUrl, API);
});

test("one explicit URL still lets the other derive from APP_URL", () => {
  const resolved = resolveAppUrls(
    { appUrl: APP, frontendUrl: WEB, betterAuthUrl: "" },
    "production",
  );
  assert.equal(resolved.frontendUrl, WEB);
  assert.equal(resolved.betterAuthUrl, APP);
});

test("no URL at all throws in production, naming APP_URL as the alternative", () => {
  assert.throws(
    () =>
      resolveAppUrls(
        { appUrl: "", frontendUrl: "", betterAuthUrl: "" },
        "production",
      ),
    /BETTER_AUTH_URL \(or set APP_URL\)/,
  );
  assert.throws(
    () =>
      resolveAppUrls({ appUrl: "", frontendUrl: "", betterAuthUrl: API }, "production"),
    /FRONTEND_URL \(or set APP_URL\)/,
  );
});

test("outside production a missing URL is empty rather than fatal", () => {
  const resolved = resolveAppUrls(
    { appUrl: "", frontendUrl: "", betterAuthUrl: "" },
    "development",
  );
  assert.equal(resolved.frontendUrl, "");
  assert.equal(resolved.betterAuthUrl, "");
});
