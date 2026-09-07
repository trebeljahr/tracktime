// Deny by default, proved rather than assumed.
//
// The whole authorization model for the public REST API is one predicate:
// does the token carry the scope this route requires? Everything that could
// go wrong with it is silent — a default that fills an empty list in, an
// implication ("write implies read") added for convenience, a route wired to
// the wrong constant. This file pins all three.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Subpath import: a bare named import from "@starter/shared" throws under
// tsx. See the note in duration.test.ts.
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@starter/shared/api-tokens";
import { apiTokenScopeSchema, createApiTokenSchema } from "@starter/shared/schemas";
import { hasScope } from "../auth/api-token.js";

describe("the scope list", () => {
  it("is exactly the five the API is documented with", () => {
    assert.deepEqual([...API_TOKEN_SCOPES], [
      "entries:read",
      "entries:write",
      "catalog:read",
      "catalog:write",
      "reports:read",
    ]);
  });

  it("validates from the same list the type is built from", () => {
    for (const scope of API_TOKEN_SCOPES) {
      assert.equal(apiTokenScopeSchema.parse(scope), scope);
    }
    assert.equal(apiTokenScopeSchema.safeParse("entries:delete").success, false);
    assert.equal(apiTokenScopeSchema.safeParse("*").success, false);
  });
});

describe("a token with no scopes", () => {
  it("grants nothing at all", () => {
    for (const scope of API_TOKEN_SCOPES) {
      assert.equal(hasScope([], scope), false, scope);
    }
  });

  it("grants nothing when the field is missing entirely", () => {
    // Rows written before `scopes` existed read back as null/undefined. The
    // guard must treat that as "nothing", never as "everything".
    for (const scope of API_TOKEN_SCOPES) {
      assert.equal(hasScope(null, scope), false, scope);
      assert.equal(hasScope(undefined, scope), false, scope);
    }
  });

  it("is a legal thing to ask for — useless, not rejected", () => {
    // No `.min(1)` and no default: a zero-scope token is the closed position,
    // and a default would be the one place someone could widen it later.
    const parsed = createApiTokenSchema.parse({ name: "ci", scopes: [] });
    assert.deepEqual(parsed.scopes, []);
    assert.equal(
      createApiTokenSchema.safeParse({ name: "ci" }).success,
      false,
      "scopes must be stated explicitly, never defaulted",
    );
  });
});

describe("scope × requirement", () => {
  /** Every cell: what a token holding `granted` may do at a route needing X. */
  const table: { granted: ApiTokenScope[]; allows: ApiTokenScope[] }[] = [
    { granted: [], allows: [] },
    { granted: ["entries:read"], allows: ["entries:read"] },
    // The one implication people expect and this deliberately does not make.
    { granted: ["entries:write"], allows: ["entries:write"] },
    {
      granted: ["entries:read", "entries:write"],
      allows: ["entries:read", "entries:write"],
    },
    { granted: ["catalog:read"], allows: ["catalog:read"] },
    { granted: ["catalog:write"], allows: ["catalog:write"] },
    // Reports are their own axis: reading entries does not grant reading the
    // aggregates over them, which carry money the entry list does not.
    { granted: ["entries:read"], allows: ["entries:read"] },
    { granted: ["reports:read"], allows: ["reports:read"] },
    { granted: [...API_TOKEN_SCOPES], allows: [...API_TOKEN_SCOPES] },
  ];

  it("allows exactly what was granted and nothing adjacent", () => {
    for (const row of table) {
      for (const required of API_TOKEN_SCOPES) {
        assert.equal(
          hasScope(row.granted, required),
          row.allows.includes(required),
          `granted [${row.granted.join(", ")}] at a route requiring ${required}`,
        );
      }
    }
  });

  it("does not let a duplicate stand in for a different scope", () => {
    assert.equal(hasScope(["entries:read", "entries:read"], "entries:write"), false);
  });
});
