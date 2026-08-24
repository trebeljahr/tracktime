import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  extractBearerToken,
  generateApiToken,
  hashApiToken,
  looksLikeApiToken,
} from "../auth/api-token.js";

// Only the pure, DB-free half of the module is exercised here — `verifyApiToken`
// and `resolveApiTokenPrincipal` need a live Mongo connection.

const TOKEN_SHAPE = /^tt_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/;

// ── hashApiToken ─────────────────────────────────────────────────────

test("hashApiToken is a plain SHA-256 hex digest of the full token", () => {
  assert.equal(
    hashApiToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(hashApiToken("abc").length, 64);
});

test("hashApiToken is deterministic and sensitive to every character", () => {
  const token = "tt_abcdefgh_0123456789abcdef0123456789abcdef";
  assert.equal(hashApiToken(token), hashApiToken(token));
  assert.notEqual(hashApiToken(token), hashApiToken(`${token}x`));
  assert.notEqual(hashApiToken(token), hashApiToken(token.toUpperCase()));
});

// ── generateApiToken ─────────────────────────────────────────────────

test("generateApiToken mints a tt_<prefix>_<secret> token", () => {
  const generated = generateApiToken();
  assert.match(generated.token, TOKEN_SHAPE);
  assert.equal(generated.prefix.length, 8);
  assert.ok(looksLikeApiToken(generated.token));
});

test("generateApiToken embeds the returned prefix in the token", () => {
  const generated = generateApiToken();
  assert.equal(generated.token.split("_")[1], generated.prefix);
});

test("generateApiToken stores only the hash of the full plaintext", () => {
  const generated = generateApiToken();
  assert.equal(generated.tokenHash, hashApiToken(generated.token));
  assert.equal(
    generated.tokenHash,
    createHash("sha256").update(generated.token, "utf8").digest("hex")
  );
  // The secret must not be recoverable from what gets persisted.
  assert.ok(!generated.tokenHash.includes(generated.token.split("_")[2]));
});

test("generateApiToken never repeats a token", () => {
  const tokens = new Set<string>();
  const prefixes = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const generated = generateApiToken();
    tokens.add(generated.token);
    prefixes.add(generated.prefix);
  }
  assert.equal(tokens.size, 200);
  assert.ok(prefixes.size > 190, "prefixes should be effectively unique too");
});

// ── looksLikeApiToken ────────────────────────────────────────────────

test("looksLikeApiToken accepts a well-formed token, whitespace and all", () => {
  const { token } = generateApiToken();
  assert.equal(looksLikeApiToken(token), true);
  assert.equal(looksLikeApiToken(`  ${token}  `), true);
});

test("looksLikeApiToken rejects anything that is not exactly the scheme", () => {
  const { token } = generateApiToken();
  const [, prefix, secret] = token.split("_");

  assert.equal(looksLikeApiToken(""), false);
  assert.equal(looksLikeApiToken("tt_"), false);
  assert.equal(looksLikeApiToken(`tt_${prefix}`), false);
  assert.equal(looksLikeApiToken(`xx_${prefix}_${secret}`), false);
  assert.equal(looksLikeApiToken(`tt_${prefix}_${secret}x`), false);
  assert.equal(looksLikeApiToken(`tt_${prefix.slice(1)}_${secret}`), false);
  assert.equal(looksLikeApiToken(`tt_${prefix}_${secret.slice(1)}`), false);
  assert.equal(looksLikeApiToken(`tt_${prefix}-${secret}`), false);
  // Surrounding whitespace — including a trailing newline — is trimmed first.
  assert.equal(looksLikeApiToken(`tt_${prefix}_${secret}\n`), true);
  assert.equal(
    looksLikeApiToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"),
    false
  );
});

// ── extractBearerToken ───────────────────────────────────────────────

test("extractBearerToken pulls a token out of an Authorization header", () => {
  const { token } = generateApiToken();
  assert.equal(extractBearerToken(`Bearer ${token}`), token);
  assert.equal(extractBearerToken(`bearer ${token}`), token);
  assert.equal(extractBearerToken(`BEARER   ${token}`), token);
  assert.equal(extractBearerToken(`  Bearer ${token}  `), token);
});

test("extractBearerToken reads the first value of a repeated header", () => {
  const { token } = generateApiToken();
  assert.equal(extractBearerToken([`Bearer ${token}`, "Bearer other"]), token);
});

test("extractBearerToken returns null for anything that is not our token", () => {
  const { token } = generateApiToken();
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken([]), null);
  assert.equal(extractBearerToken("Bearer"), null);
  assert.equal(extractBearerToken(token), null, "the scheme is required");
  assert.equal(extractBearerToken(`Basic ${token}`), null);
  assert.equal(extractBearerToken("Bearer sk_live_not_our_token"), null);
  assert.equal(extractBearerToken(`Bearer ${token} extra`), null);
});
