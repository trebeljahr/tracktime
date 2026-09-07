// The token credential itself: what a minted one looks like, and what a
// presented one has to match.
//
// Worth pinning without a database because every property here is a security
// property. A regression in any of them looks exactly like working code.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashApiToken,
  mintApiToken,
  parseApiToken,
  verifyApiToken,
} from "../auth/api-token.js";

describe("minting an API token", () => {
  it("produces the documented shape", () => {
    const { plaintext, prefix } = mintApiToken();

    assert.ok(plaintext.startsWith("tt_"), plaintext);
    // tt_ (3) + prefix (8) + _ (1) + secret (43)
    assert.equal(plaintext.length, 55);
    assert.equal(prefix.length, 8);
    assert.equal(plaintext.slice(3, 11), prefix);
    assert.equal(plaintext[11], "_");
    assert.match(plaintext.slice(12), /^[A-Za-z0-9_-]{43}$/);
  });

  it("never stores anything the plaintext can be read back from", () => {
    const { plaintext, tokenHash } = mintApiToken();

    assert.notEqual(tokenHash, plaintext);
    assert.ok(!tokenHash.includes(plaintext));
    assert.ok(!plaintext.includes(tokenHash));
    // sha256, hex.
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
  });

  it("gives every token its own prefix and secret", () => {
    const prefixes = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const minted = mintApiToken();
      prefixes.add(minted.prefix);
      hashes.add(minted.tokenHash);
    }
    assert.equal(prefixes.size, 200);
    assert.equal(hashes.size, 200);
  });
});

describe("hashing", () => {
  it("covers the WHOLE plaintext, prefix included", () => {
    const { plaintext, prefix, tokenHash } = mintApiToken();
    const secretOnly = plaintext.slice(12);

    assert.equal(hashApiToken(plaintext), tokenHash);
    // If the hash covered only the secret, a stolen prefix could be re-paired
    // with a secret from elsewhere and still match.
    assert.notEqual(hashApiToken(secretOnly), tokenHash);
    assert.notEqual(hashApiToken(prefix), tokenHash);
  });

  it("is stable and case-sensitive", () => {
    assert.equal(hashApiToken("tt_abc"), hashApiToken("tt_abc"));
    assert.notEqual(hashApiToken("tt_abc"), hashApiToken("tt_abC"));
  });
});

describe("parsing a presented token", () => {
  it("recovers the prefix a minted token was built from", () => {
    for (let i = 0; i < 50; i += 1) {
      const { plaintext, prefix } = mintApiToken();
      assert.deepEqual(parseApiToken(plaintext), { prefix });
    }
  });

  it("parses by position, so a `_` inside base64url is not a separator", () => {
    // base64url includes `_`. A split-based parse would address the wrong row
    // (or none) for a perfectly valid token, so build one that contains it.
    const prefix = "ab_cd-ef";
    const secret = "_".padEnd(43, "x");
    assert.deepEqual(parseApiToken(`tt_${prefix}_${secret}`), { prefix });
  });

  it("refuses anything that is not the exact shape", () => {
    const { plaintext } = mintApiToken();
    assert.equal(parseApiToken(""), null);
    assert.equal(parseApiToken("not-a-token"), null);
    // Wrong scheme.
    assert.equal(parseApiToken(`xx_${plaintext.slice(3)}`), null);
    // Truncated, and one character too long.
    assert.equal(parseApiToken(plaintext.slice(0, -1)), null);
    assert.equal(parseApiToken(`${plaintext}x`), null);
    // Separator in the wrong place.
    assert.equal(
      parseApiToken(`tt_${"a".repeat(9)}${"b".repeat(43)}`),
      null,
    );
    // A character outside the base64url alphabet.
    assert.equal(
      parseApiToken(`tt_${"a".repeat(8)}_${"!".padEnd(43, "b")}`),
      null,
    );
  });
});

describe("verifying a presented token", () => {
  it("accepts the plaintext it was minted from", () => {
    const { plaintext, tokenHash } = mintApiToken();
    assert.equal(verifyApiToken(plaintext, tokenHash), true);
  });

  it("rejects a wrong secret", () => {
    const { plaintext, tokenHash } = mintApiToken();
    const tampered = `${plaintext.slice(0, -1)}${plaintext.endsWith("A") ? "B" : "A"}`;
    assert.equal(verifyApiToken(tampered, tokenHash), false);
  });

  it("rejects a real prefix re-paired with a FOREIGN secret", () => {
    const mine = mintApiToken();
    const theirs = mintApiToken();
    const forged = `tt_${mine.prefix}_${theirs.plaintext.slice(12)}`;

    assert.deepEqual(parseApiToken(forged), { prefix: mine.prefix });
    assert.equal(verifyApiToken(forged, mine.tokenHash), false);
    assert.equal(verifyApiToken(forged, theirs.tokenHash), false);
  });

  it("rejects a corrupt stored hash instead of throwing", () => {
    const { plaintext } = mintApiToken();
    // `timingSafeEqual` throws on a length mismatch, so the length assertion
    // has to come first or a truncated column becomes a 500.
    assert.equal(verifyApiToken(plaintext, ""), false);
    assert.equal(verifyApiToken(plaintext, "abcd"), false);
    assert.equal(verifyApiToken(plaintext, "z".repeat(64)), false);
  });
});
