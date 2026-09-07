// Who, WITHIN one workspace, may act on an API token or a webhook.
//
// The workspace boundary was always enforced; this one was not, and its
// absence was not visible in any test because every query looked scoped —
// `{ workspaceId }` reads as an authorization check right up to the moment
// you ask "whose?". Two things went wrong under it:
//
//  - Any member could revoke a colleague's API token: a running integration
//    switched off by someone who never minted it.
//  - Any member could repoint a colleague's webhook subscription at a URL of
//    their choosing. Deliveries are projected against `createdBy`'s LIVE
//    visibility, so a member without `canViewOthersMoney` could receive
//    payloads projected against a colleague who has it — an escalation with
//    an attacker-chosen exfiltration endpoint, signed by this server.
//
// These tests exercise the FILTERS the routers hand to Mongo, because the
// filter is where the rule lives: there is no branch in the resolver to test,
// and there deliberately isn't one — a match that misses cannot be raced, and
// cannot be refactored into a read that forgets to compare afterwards.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_LIVE_TOKENS_PER_MEMBER,
  ownTokenFilter,
  revocableTokenFilter,
} from "../trpc/routers/api-tokens.js";
import {
  ownWebhookByIdFilter,
  ownWebhookFilter,
} from "../trpc/routers/webhooks.js";

const ALICE = "user_alice";
const BOB = "user_bob";
const WORKSPACE = "ws_shared";

/**
 * Mongo's matching rules, for the only shapes these filters use.
 *
 * Top-level keys are ANDed and compared by equality; `{ field: null }` also
 * matches a document where the field is absent, which is why a token written
 * before `revokedAt` existed still reads as "not revoked" rather than as
 * unmatchable. Anything richer than this is not in these filters, and if it
 * ever is, this helper should fail loudly rather than quietly approximate.
 */
function matches(
  filter: Readonly<Record<string, unknown>>,
  doc: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    assert.ok(
      expected === null || typeof expected === "string",
      `this matcher only models scalar equality; ${key} is richer than that`,
    );
    const actual = doc[key];
    if (expected === null) return actual === null || actual === undefined;
    return actual === expected;
  });
}

/** Alice's token, as it sits in the collection. */
const aliceToken = {
  _id: "token_1",
  workspaceId: WORKSPACE,
  userId: ALICE,
  revokedAt: null,
};

/** Alice's subscription — the one whose url is the interesting field. */
const aliceWebhook = {
  _id: "wh_1",
  workspaceId: WORKSPACE,
  createdBy: ALICE,
};

describe("an API token belongs to the member who minted it", () => {
  it("lists only the caller's own tokens, never the workspace's", () => {
    const mine = ownTokenFilter(WORKSPACE, ALICE);
    assert.equal(mine.userId, ALICE);
    assert.ok(matches(mine, aliceToken));

    // The bug this replaces: Bob asking for the list and being handed
    // Alice's token names and prefixes.
    assert.equal(matches(ownTokenFilter(WORKSPACE, BOB), aliceToken), false);
  });

  it("lets the creator revoke it", () => {
    assert.ok(
      matches(revocableTokenFilter("token_1", WORKSPACE, ALICE), aliceToken),
    );
  });

  it("does NOT let a colleague in the same workspace revoke it", () => {
    // Same workspace, same id, right up-to-date session — and still a miss,
    // which the router turns into NOT_FOUND rather than FORBIDDEN so the id
    // is not confirmed to exist.
    assert.equal(
      matches(revocableTokenFilter("token_1", WORKSPACE, BOB), aliceToken),
      false,
    );
  });

  it("does not let a second revoke rewrite the first one's timestamp", () => {
    const revoked = { ...aliceToken, revokedAt: "2026-09-01T10:00:00.000Z" };
    assert.equal(
      matches(revocableTokenFilter("token_1", WORKSPACE, ALICE), revoked),
      false,
    );
  });

  it("treats a row written before `revokedAt` existed as live", () => {
    const legacy = { _id: "token_1", workspaceId: WORKSPACE, userId: ALICE };
    assert.ok(
      matches(revocableTokenFilter("token_1", WORKSPACE, ALICE), legacy),
      "an absent revokedAt must read as not-revoked, not as unmatchable",
    );
  });

  it("caps how many live tokens one member may hold", () => {
    // Unbounded minting is how a per-token rate limit is bypassed: one
    // budget per token, and a loop mints tokens.
    assert.ok(MAX_LIVE_TOKENS_PER_MEMBER > 0);
    assert.ok(
      MAX_LIVE_TOKENS_PER_MEMBER <= 50,
      "a cap high enough to be a multiplier is not a cap",
    );
  });
});

describe("a webhook subscription belongs to the member who created it", () => {
  it("lists only the caller's own subscriptions", () => {
    // A webhook URL is frequently a credential in its own right — the token
    // sits in the path — so a workspace-wide list hands out colleagues'
    // secrets in the name of oversight.
    assert.ok(matches(ownWebhookFilter(WORKSPACE, ALICE), aliceWebhook));
    assert.equal(
      matches(ownWebhookFilter(WORKSPACE, BOB), aliceWebhook),
      false,
    );
  });

  it("lets the creator change its url", () => {
    assert.ok(
      matches(ownWebhookByIdFilter("wh_1", WORKSPACE, ALICE), aliceWebhook),
    );
  });

  it("does NOT let a colleague change its url", () => {
    // THE finding. Deliveries are projected against Alice's live visibility,
    // so a url Bob may set is a channel that hands Bob what Alice may see.
    assert.equal(
      matches(ownWebhookByIdFilter("wh_1", WORKSPACE, BOB), aliceWebhook),
      false,
    );
  });

  it("does not let a colleague delete it or read its delivery log", () => {
    // Same filter, so the answer cannot drift apart between the three: an
    // ownership rule enforced on `update` alone would still leak the events
    // and failures of somebody else's endpoint through `deliveries`.
    const bob = ownWebhookByIdFilter("wh_1", WORKSPACE, BOB);
    assert.equal(matches(bob, aliceWebhook), false);
  });

  it("fails closed on a subscription written before `createdBy` existed", () => {
    // Those rows carry the schema default, an empty string, which is nobody:
    // they deliver nothing (`ownerVisibility` finds no membership) and now
    // they are editable by nobody either. Inert, not up for grabs.
    const legacy = { _id: "wh_1", workspaceId: WORKSPACE, createdBy: "" };
    assert.equal(
      matches(ownWebhookByIdFilter("wh_1", WORKSPACE, ALICE), legacy),
      false,
    );
  });
});

// ── the source-level guard ───────────────────────────────────────────
//
// The unit tests above prove the filters are right. This proves the routers
// still USE them: the regression is not a wrong filter, it is a new query
// added next to the old ones with `{ workspaceId: ctx.workspaceId }` typed
// out by hand, which looks exactly like the code around it.

const ROUTERS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "trpc",
  "routers",
);

const read = (file: string): string =>
  readFileSync(join(ROUTERS_DIR, file), "utf8");

/** Every read/write call site on a model, and the filter it was handed. */
function queryCallSites(source: string, model: string): string[] {
  const pattern = new RegExp(
    `${model}\\.(find|findOne|findOneAndUpdate|findOneAndDelete|countDocuments|updateOne|updateMany|deleteOne|deleteMany|exists)\\(`,
    "g",
  );
  const sites: string[] = [];
  for (const match of source.matchAll(pattern)) {
    // The filter is the first argument; 220 characters covers the longest of
    // them here with room to spare.
    sites.push(source.slice(match.index, match.index + 220));
  }
  return sites;
}

describe("every credential query stays scoped to its owner", () => {
  it("scopes each ApiToken query with the owner filter", () => {
    const sites = queryCallSites(read("api-tokens.ts"), "ApiToken");
    assert.ok(sites.length >= 3, "expected list, create's cap check, revoke");
    for (const site of sites) {
      assert.ok(
        site.includes("ownTokenFilter") || site.includes("revocableTokenFilter"),
        `an ApiToken query that does not go through the owner filter:\n${site}`,
      );
    }
  });

  it("scopes each WebhookSubscription query with the creator filter", () => {
    const source = read("webhooks.ts");
    const sites = queryCallSites(source, "WebhookSubscription");
    assert.ok(sites.length >= 4, "expected list, update, remove, deliveries");
    for (const site of sites) {
      assert.ok(
        site.includes("ownWebhookFilter") ||
          site.includes("ownWebhookByIdFilter"),
        `a WebhookSubscription query that does not go through the creator ` +
          `filter:\n${site}`,
      );
    }
  });

  it("still counts a member's live tokens before minting another", () => {
    const source = read("api-tokens.ts");
    assert.ok(source.includes("countDocuments"));
    assert.ok(
      source.includes("MAX_LIVE_TOKENS_PER_MEMBER"),
      "the per-member cap is what keeps the per-token rate limit meaningful",
    );
  });
});
