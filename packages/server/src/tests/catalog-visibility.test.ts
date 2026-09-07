// What a catalog read may say about other people's work.
//
// Two leaks lived here, and both were invisible from the outside: the response
// was well-formed, the status was 200, and the numbers looked exactly as they
// should. Nothing but a test can tell "this total is the caller's" from "this
// total is the workspace's" — they are both just integers.
//
// So every case below is stated from the negative side (what must NOT be on
// the wire), and every one of them is paired with its positive twin (a caller
// who may see everything still does). A fix that returns less to everybody is
// not a fix, and the positive cases are what stops this file being satisfied
// by one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Subpath imports: a bare named import from "@starter/shared" throws under
// tsx. See the note in ws-sync.test.ts.
import type {
  CatalogRemoveResult,
  Visibility,
} from "@starter/shared/types";
import type { BudgetProgress } from "@starter/shared/budgets";
import {
  projectProjectForVisibility,
  projectRemoveResult,
  rollupVisibility,
} from "@starter/shared/visibility";
import {
  catalogEntryRollup,
  scopeRollupMatch,
} from "../services/catalog/rollup.js";

const ME = "user-me";
const WORKSPACE = "ws-1";

const visibility = (
  canViewOthersTime: boolean,
  canViewOthersMoney: boolean,
): Visibility => ({ userId: ME, canViewOthersTime, canViewOthersMoney });

/** The caller in the report: a member who may see neither. */
const NARROW = visibility(false, false);
/** The owner who may see everything — the control in every case below. */
const WIDE = visibility(true, true);
/**
 * The visibility the first matrix missed, and the only one where the money
 * rule and the time rule disagree: colleague TIME is allowed, colleague MONEY
 * is not. Author-scoping a roll-up on the time flag alone leaves exactly this
 * caller reading the withheld number off the two factors beside it.
 */
const TIME_NOT_MONEY = visibility(true, false);
/** Its mirror, which the time flag already restricts. */
const MONEY_NOT_TIME = visibility(false, true);

const progress: BudgetProgress = {
  trackedSec: 720_000,
  billableSec: 720_000,
  estimatedHours: 500,
  budgetAmount: 4_000_000,
  currency: "EUR",
  // Aggregate colleague earnings. This single number is the whole reason
  // `progress` is gated.
  spentAmount: 3_000_000,
  spentByCurrency: [{ currency: "EUR", amount: 3_000_000, seconds: 720_000 }],
  hoursRatio: 0.4,
  amountRatio: 0.75,
  hoursStatus: "under",
  amountStatus: "under",
  remainingSec: 1_080_000,
  remainingAmount: 1_000_000,
  mixedCurrency: false,
  foreignCurrencies: [],
};

/** The shape `GET /projects` and `GET /projects/:id` hand back. */
const projectRow = () => ({
  id: "project-1",
  name: "Rebrand",
  hourlyRate: 15_000,
  budgetAmount: 4_000_000,
  budgetCurrency: "EUR",
  entryCount: 200,
  totalSec: 720_000,
  progress,
});

/** The shape a create/update/archive hands back: no roll-up at all. */
const bareProject = () => ({
  id: "project-1",
  name: "Rebrand",
  hourlyRate: 15_000,
  budgetAmount: 4_000_000,
  budgetCurrency: "EUR",
});

describe("project money projection", () => {
  it("withholds progress from a caller who may not see others' work", () => {
    const projected = projectProjectForVisibility(projectRow(), NARROW);

    // The leak as reported: `progress` was nulled and the numbers it is
    // computed FROM were returned on the same object, so `spentAmount` was
    // reconstructible as hourlyRate x totalSec / 3600.
    assert.equal(projected.progress, null);
  });

  it("keeps rate and budget, which are workspace configuration", () => {
    const projected = projectProjectForVisibility(projectRow(), NARROW);

    // Deliberate, and asserted so a later "tighten everything" pass has to
    // argue with a test rather than silently win: the rate is the one this
    // caller's OWN entries are already stamped with, and the budget is the
    // target the job was sold at. Neither is derived from anybody else's
    // work. See the rule in @starter/shared/visibility.
    assert.equal(projected.hourlyRate, 15_000);
    assert.equal(projected.budgetAmount, 4_000_000);
    assert.equal(projected.budgetCurrency, "EUR");
    assert.equal(projected.name, "Rebrand");
  });

  it("withholds progress when either half of the permission is missing", () => {
    // Money but not time: `trackedSec` is still aggregate colleague hours.
    assert.equal(
      projectProjectForVisibility(projectRow(), visibility(false, true))
        .progress,
      null,
    );
    // Time but not money: `spentAmount` is still aggregate colleague earnings.
    assert.equal(
      projectProjectForVisibility(projectRow(), visibility(true, false))
        .progress,
      null,
    );
  });

  it("returns the row untouched to a caller who may see everything", () => {
    const row = projectRow();
    const projected = projectProjectForVisibility(row, WIDE);

    // Identity, not a copy: a caller with both flags runs no projection at
    // all, which is what keeps "withhold from nobody" distinguishable from
    // "withhold from everybody".
    assert.equal(projected, row);
    assert.deepEqual(projected.progress, progress);
    assert.equal(projected.progress?.spentAmount, 3_000_000);
  });

  it("does not invent a progress key on a create/update response", () => {
    const projected = projectProjectForVisibility(bareProject(), NARROW);

    // The write routes are projected too — a write that echoes back what a
    // read would have withheld is the same leak by another verb — but a shape
    // that never carried `progress` must not grow one, or clients learn to
    // expect a key that is absent everywhere else.
    assert.equal("progress" in projected, false);
    assert.equal(projected.hourlyRate, 15_000);
  });
});

describe("catalog roll-up author scoping", () => {
  it("restricts a roll-up match to the caller's own entries", () => {
    const match = scopeRollupMatch({ workspaceId: WORKSPACE }, NARROW);

    assert.deepEqual(match, { workspaceId: WORKSPACE, authorId: ME });
  });

  it("leaves the tag roll-up's own conditions in place", () => {
    // Tags roll up through a plain `$match`, not an `$expr` sub-pipeline, so
    // this is the case where a careless merge would drop `tagIds.0` and start
    // counting untagged time.
    const match = scopeRollupMatch(
      { workspaceId: WORKSPACE, "tagIds.0": { $exists: true } },
      NARROW,
    );

    assert.deepEqual(match, {
      workspaceId: WORKSPACE,
      "tagIds.0": { $exists: true },
      authorId: ME,
    });
  });

  it("adds no restriction for a caller who may see others' time", () => {
    const match = scopeRollupMatch({ workspaceId: WORKSPACE }, WIDE);

    assert.deepEqual(match, { workspaceId: WORKSPACE });
    assert.equal("authorId" in match, false);
  });

  for (const entryField of ["projectId", "taskId"] as const) {
    it(`scopes the ${entryField} roll-up lookup`, () => {
      const stage = catalogEntryRollup({
        workspaceId: WORKSPACE,
        visibility: NARROW,
        entryField,
        as: "stats",
      });

      const [first] = stage.$lookup.pipeline ?? [];
      assert.deepEqual(first, {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$workspaceId", WORKSPACE] },
              { $eq: [`$${entryField}`, "$$rowId"] },
            ],
          },
          authorId: ME,
        },
      });
    });

    it(`leaves the ${entryField} roll-up whole-workspace when allowed`, () => {
      const stage = catalogEntryRollup({
        workspaceId: WORKSPACE,
        visibility: WIDE,
        entryField,
        as: "stats",
      });

      // Serialised rather than shape-matched: this has to fail if `authorId`
      // turns up ANYWHERE in the pipeline, including inside a nested `$expr`
      // somebody adds later.
      assert.equal(JSON.stringify(stage).includes("authorId"), false);
      assert.equal(JSON.stringify(stage).includes("$$rowId"), true);
    });
  }
});

describe("catalog roll-up money scoping", () => {
  // The case the matrix above missed. `canViewOthersTime` is on, so every
  // author-scope test above passes for this caller while the roll-up still
  // sums the whole workspace — and the whole workspace is one factor of the
  // number `progress` withholds.
  it("scopes the roll-up when the money beside it is withheld", () => {
    const scoped = rollupVisibility(TIME_NOT_MONEY);

    assert.deepEqual(scoped, {
      userId: ME,
      canViewOthersTime: false,
      canViewOthersMoney: false,
    });
    assert.deepEqual(scopeRollupMatch({ workspaceId: WORKSPACE }, scoped), {
      workspaceId: WORKSPACE,
      authorId: ME,
    });
  });

  it("closes the hourlyRate x totalSec reconstruction", () => {
    // The arithmetic, spelled out on the fixture so it cannot be argued with:
    // the row's own rate times the row's own total IS the withheld amount.
    assert.equal(
      (projectRow().hourlyRate * projectRow().totalSec) / 3600,
      progress.spentAmount,
    );

    // So both factors may not ship together. `progress` goes...
    const projected = projectProjectForVisibility(projectRow(), TIME_NOT_MONEY);
    assert.equal(projected.progress, null);

    // ...and the total the surviving rate would be multiplied by is counted
    // over the caller's OWN entries, which makes the product the caller's own
    // spend rather than the workspace's. Nulling `hourlyRate` instead would
    // have been theatre: the caller reads the same rate off their own entries.
    const stage = catalogEntryRollup({
      workspaceId: WORKSPACE,
      visibility: rollupVisibility(TIME_NOT_MONEY),
      entryField: "projectId",
      as: "stats",
    });

    const [first] = stage.$lookup.pipeline ?? [];
    assert.deepEqual(first, {
      $match: {
        $expr: {
          $and: [
            { $eq: ["$workspaceId", WORKSPACE] },
            { $eq: ["$projectId", "$$rowId"] },
          ],
        },
        authorId: ME,
      },
    });
  });

  it("scopes the task and tag roll-ups the same way", () => {
    // Same conjunction on all three, because the task total is priced by its
    // project's rate, and the tag total is the widest sum in the workspace. A
    // rule that holds for one roll-up and not the others is not a rule.
    const scoped = rollupVisibility(TIME_NOT_MONEY);

    const taskStage = catalogEntryRollup({
      workspaceId: WORKSPACE,
      visibility: scoped,
      entryField: "taskId",
      as: "stats",
    });
    assert.equal(JSON.stringify(taskStage).includes(`"authorId":"${ME}"`), true);

    assert.deepEqual(
      scopeRollupMatch(
        { workspaceId: WORKSPACE, "tagIds.0": { $exists: true } },
        scoped,
      ),
      {
        workspaceId: WORKSPACE,
        "tagIds.0": { $exists: true },
        authorId: ME,
      },
    );
  });

  it("keeps the caller who may see neither restricted", () => {
    // The narrowing must not accidentally WIDEN anybody: money on, time off
    // stays author-scoped, and so does the member with neither flag.
    assert.deepEqual(scopeRollupMatch({}, rollupVisibility(MONEY_NOT_TIME)), {
      authorId: ME,
    });
    assert.deepEqual(scopeRollupMatch({}, rollupVisibility(NARROW)), {
      authorId: ME,
    });
  });

  it("leaves a caller who may see everything unrestricted", () => {
    // The positive twin. Identity, not a rebuilt object, so "narrowed for
    // nobody" stays distinguishable from "narrowed for everybody".
    assert.equal(rollupVisibility(WIDE), WIDE);

    const stage = catalogEntryRollup({
      workspaceId: WORKSPACE,
      visibility: rollupVisibility(WIDE),
      entryField: "projectId",
      as: "stats",
    });

    assert.equal(JSON.stringify(stage).includes("authorId"), false);
    assert.equal(JSON.stringify(stage).includes("$$rowId"), true);
  });
});

describe("catalog delete collateral", () => {
  /** What the cascade actually touched, across every member. */
  const cascade: CatalogRemoveResult = {
    entriesDetached: 200,
    tasksDeleted: 4,
    projectsDetached: 0,
    favoritesDetached: 7,
  };
  /** The caller's own share of it, counted before the cascade ran. */
  const own = { entriesDetached: 3, favoritesDetached: 1 };

  it("reports the caller's own collateral, not the workspace's", () => {
    const projected = projectRemoveResult(cascade, own);

    // The leak by the other verb: a member who may not see colleague entries
    // reads their count straight off `entriesDetached` by deleting the
    // project — the exact number the roll-up above withholds — and the
    // colleagues' pin count off `favoritesDetached`.
    assert.equal(projected.entriesDetached, 3);
    assert.equal(projected.favoritesDetached, 1);
  });

  it("does not zero the counts", () => {
    const projected = projectRemoveResult(cascade, own);

    // Zero is not the safe answer, it is a false one: every client renders an
    // all-zero result as "Nothing else referenced it", which is a claim about
    // the caller's OWN entries and wrong whenever they had any.
    assert.notEqual(projected.entriesDetached, 0);
  });

  it("keeps the catalog counts, which disclose nothing", () => {
    const projected = projectRemoveResult(cascade, own);

    // Tasks and projects are catalog rows every member may already list in
    // full. Withholding them would hide what the delete actually did while
    // protecting nothing.
    assert.equal(projected.tasksDeleted, 4);
    assert.equal(projected.projectsDetached, 0);
  });

  it("hands a caller who may see everything the cascade's own numbers", () => {
    // The positive twin: `null` is the service saying "nothing to withhold",
    // and it must be identity rather than a rebuilt copy.
    assert.equal(projectRemoveResult(cascade, null), cascade);
  });
});
