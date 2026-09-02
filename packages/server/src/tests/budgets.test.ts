import assert from "node:assert/strict";
import test from "node:test";
// Subpath imports: a bare named import from "@starter/shared" throws under tsx.
// See the note in duration.test.ts.
import {
  BUDGET_NEAR_RATIO,
  budgetStatus,
  computeBudgetProgress,
  hasBudgetTarget,
  overallBudgetStatus,
  type BudgetEntry,
  type ProjectBudget,
} from "@starter/shared/budgets";
import { entryAmount, sumAmounts } from "@starter/shared/rates";
import {
  budgetWrite,
  needsCurrency,
  touchesBudget,
} from "../trpc/routers/project-budgets.js";

const HOUR = 3600;

const NO_TARGET: ProjectBudget = {
  estimatedHours: null,
  budgetAmount: null,
  budgetCurrency: null,
};

const entry = (over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  seconds: HOUR,
  billable: true,
  hourlyRate: 60,
  currency: "EUR",
  ...over,
});

// ── no target set ────────────────────────────────────────────────────

test("hasBudgetTarget tells a missing target apart from a zero one", () => {
  assert.equal(hasBudgetTarget(NO_TARGET), false);
  assert.equal(hasBudgetTarget({ ...NO_TARGET, estimatedHours: 0 }), true);
  assert.equal(
    hasBudgetTarget({ estimatedHours: null, budgetAmount: 0, budgetCurrency: "EUR" }),
    true,
  );
});

test("a project with no budget reports null ratios, never 0% of 0", () => {
  const progress = computeBudgetProgress(NO_TARGET, [entry(), entry()]);

  assert.equal(progress.trackedSec, 2 * HOUR);
  assert.equal(progress.hoursRatio, null);
  assert.equal(progress.amountRatio, null);
  assert.equal(progress.hoursStatus, "none");
  assert.equal(progress.amountStatus, "none");
  assert.equal(progress.remainingSec, null);
  assert.equal(progress.remainingAmount, null);
  assert.equal(overallBudgetStatus(progress), "none");
  // Earnings are still measured — only the comparison is missing.
  assert.equal(progress.spentAmount, 120);
  assert.equal(progress.currency, "EUR");
});

test("a project with no entries at all still reports its target", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: 80, budgetAmount: 6000, budgetCurrency: "EUR" },
    [],
  );

  assert.equal(progress.trackedSec, 0);
  assert.equal(progress.spentAmount, 0);
  assert.equal(progress.hoursRatio, 0);
  assert.equal(progress.amountRatio, 0);
  assert.equal(progress.hoursStatus, "under");
  assert.equal(progress.remainingSec, 80 * HOUR);
  assert.equal(progress.remainingAmount, 6000);
  assert.equal(progress.mixedCurrency, false);
});

// ── hours progress ───────────────────────────────────────────────────

test("hours progress measures tracked time against the estimate", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: 80, budgetAmount: null, budgetCurrency: null },
    [entry({ seconds: 62 * HOUR })],
  );

  assert.equal(progress.trackedSec, 62 * HOUR);
  assert.equal(progress.hoursRatio, 62 / 80);
  assert.equal(progress.hoursStatus, "under");
  assert.equal(progress.remainingSec, 18 * HOUR);
  // No money budget — the money side stays "not set".
  assert.equal(progress.amountRatio, null);
  assert.equal(progress.amountStatus, "none");
});

test("non-billable time still spends the hours estimate", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: 10, budgetAmount: 1000, budgetCurrency: "EUR" },
    [entry({ seconds: 6 * HOUR, billable: false }), entry({ seconds: 2 * HOUR })],
  );

  assert.equal(progress.trackedSec, 8 * HOUR);
  assert.equal(progress.billableSec, 2 * HOUR);
  assert.equal(progress.hoursRatio, 0.8);
  assert.equal(progress.hoursStatus, "near");
  // Only the billable two hours earned anything.
  assert.equal(progress.spentAmount, 120);
});

test("going over the estimate reports a negative remainder", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
    [entry({ seconds: 13 * HOUR })],
  );

  assert.equal(progress.hoursStatus, "over");
  assert.equal(progress.remainingSec, -3 * HOUR);
  assert.equal(overallBudgetStatus(progress), "over");
});

// ── money progress ───────────────────────────────────────────────────

test("earnings come from each entry's own rate snapshot, mixed rates and all", () => {
  // The project's rate moved 60 → 90 partway through; the entries kept the
  // rate they were stopped at, and progress must reflect exactly that.
  const entries = [
    entry({ seconds: 3 * HOUR, hourlyRate: 60 }),
    entry({ seconds: 2 * HOUR, hourlyRate: 90 }),
    entry({ seconds: 1800, hourlyRate: 90 }),
  ];
  const progress = computeBudgetProgress(
    { estimatedHours: null, budgetAmount: 500, budgetCurrency: "EUR" },
    entries,
  );

  const expected = sumAmounts(
    entries.map((item) => entryAmount(item.seconds, item.hourlyRate)),
  );
  assert.equal(expected, 405);
  assert.equal(progress.spentAmount, expected);
  assert.equal(progress.amountRatio, 405 / 500);
  assert.equal(progress.amountStatus, "near");
  assert.equal(progress.remainingAmount, 95);
});

test("a billable entry with no rate snapshot earns nothing and claims no currency", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: null, budgetAmount: 100, budgetCurrency: "EUR" },
    [entry({ hourlyRate: null, currency: "USD" }), entry({ hourlyRate: 60 })],
  );

  assert.equal(progress.spentAmount, 60);
  assert.deepEqual(
    progress.spentByCurrency.map((spend) => spend.currency),
    ["EUR"],
  );
  assert.equal(progress.mixedCurrency, false);
});

// ── zero is a real target ────────────────────────────────────────────

test("a budget of zero is a real target, not a missing one", () => {
  const unspent = computeBudgetProgress(
    { estimatedHours: 0, budgetAmount: 0, budgetCurrency: "EUR" },
    [],
  );
  assert.equal(unspent.hoursRatio, 0);
  assert.equal(unspent.amountRatio, 0);
  assert.equal(unspent.hoursStatus, "under");

  const spent = computeBudgetProgress(
    { estimatedHours: 0, budgetAmount: 0, budgetCurrency: "EUR" },
    [entry()],
  );
  // Any time at all against a zero target is already over it — and the ratio
  // is a finite 1, never Infinity or NaN.
  assert.equal(spent.hoursRatio, 1);
  assert.equal(spent.amountRatio, 1);
  assert.equal(spent.hoursStatus, "over");
  assert.equal(spent.amountStatus, "over");
  assert.equal(spent.remainingAmount, -60);
});

// ── currency ─────────────────────────────────────────────────────────

test("entries in another currency are excluded from the budget, never summed in", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: null, budgetAmount: 1000, budgetCurrency: "EUR" },
    [
      entry({ seconds: 5 * HOUR, hourlyRate: 60, currency: "EUR" }),
      entry({ seconds: 5 * HOUR, hourlyRate: 100, currency: "USD" }),
    ],
  );

  assert.equal(progress.currency, "EUR");
  assert.equal(progress.spentAmount, 300);
  assert.equal(progress.mixedCurrency, true);
  assert.deepEqual(progress.foreignCurrencies, ["USD"]);
  assert.deepEqual(progress.spentByCurrency, [
    { currency: "USD", amount: 500, seconds: 5 * HOUR },
    { currency: "EUR", amount: 300, seconds: 5 * HOUR },
  ]);
  // 800 would be the number a naive sum produced; it is nowhere in the result.
  assert.equal(progress.amountRatio, 0.3);
});

test("without a money budget, one currency resolves and several do not", () => {
  const single = computeBudgetProgress(
    { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
    [entry({ currency: "eur" }), entry({ currency: "EUR" })],
  );
  assert.equal(single.currency, "EUR");
  assert.equal(single.spentAmount, 120);
  assert.equal(single.mixedCurrency, false);

  const several = computeBudgetProgress(
    { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
    [entry({ currency: "EUR" }), entry({ currency: "USD" })],
  );
  assert.equal(several.currency, null);
  assert.equal(several.spentAmount, 0);
  assert.equal(several.mixedCurrency, true);
  assert.deepEqual(several.foreignCurrencies, ["EUR", "USD"]);
  // The hours side is currency-free and stays perfectly usable.
  assert.equal(several.hoursRatio, 0.2);
});

// ── status thresholds ────────────────────────────────────────────────

test("budgetStatus separates no target from an empty one", () => {
  assert.equal(budgetStatus(null), "none");
  assert.equal(budgetStatus(0), "under");
  assert.equal(budgetStatus(BUDGET_NEAR_RATIO - 0.01), "under");
  assert.equal(budgetStatus(BUDGET_NEAR_RATIO), "near");
  assert.equal(budgetStatus(0.999), "near");
  assert.equal(budgetStatus(1), "over");
  assert.equal(budgetStatus(2.5), "over");
});

test("overallBudgetStatus reports the worse of the two targets", () => {
  const progress = computeBudgetProgress(
    { estimatedHours: 100, budgetAmount: 100, budgetCurrency: "EUR" },
    [entry({ seconds: 2 * HOUR, hourlyRate: 60 })],
  );

  assert.equal(progress.hoursStatus, "under");
  assert.equal(progress.amountStatus, "over");
  assert.equal(overallBudgetStatus(progress), "over");
});

// ── writing a budget ─────────────────────────────────────────────────

test("budgetWrite leaves untouched fields alone", () => {
  assert.deepEqual(budgetWrite({}, "EUR"), {});
  assert.deepEqual(budgetWrite({ estimatedHours: 80 }, "EUR"), {
    estimatedHours: 80,
  });
});

test("budgetWrite tells clearing a target apart from zeroing it", () => {
  assert.deepEqual(budgetWrite({ estimatedHours: null }, "EUR"), {
    estimatedHours: null,
  });
  assert.deepEqual(budgetWrite({ estimatedHours: 0 }, "EUR"), {
    estimatedHours: 0,
  });
});

test("a new budget snapshots the workspace currency", () => {
  assert.deepEqual(budgetWrite({ budgetAmount: 6000 }, "EUR"), {
    budgetAmount: 6000,
    budgetCurrency: "EUR",
  });
});

test("editing an existing budget keeps the currency it was agreed in", () => {
  // The workspace has since moved to USD; the budget stays denominated in the
  // currency it was quoted in, exactly as an entry keeps its rate snapshot.
  assert.deepEqual(
    budgetWrite({ budgetAmount: 7000 }, "USD", {
      budgetAmount: 6000,
      budgetCurrency: "EUR",
    }),
    { budgetAmount: 7000, budgetCurrency: "EUR" },
  );
});

test("clearing the amount clears the currency with it", () => {
  assert.deepEqual(
    budgetWrite({ budgetAmount: null }, "EUR", {
      budgetAmount: 6000,
      budgetCurrency: "EUR",
    }),
    { budgetAmount: null, budgetCurrency: null },
  );
});

test("a currency never survives without an amount to denominate", () => {
  // Naming a currency on a project that has no budget must not leave one
  // behind pointing at nothing.
  assert.deepEqual(budgetWrite({ budgetCurrency: "GBP" }, "EUR"), {
    budgetCurrency: null,
  });
  // With a budget in place it is a straight re-denomination.
  assert.deepEqual(
    budgetWrite({ budgetCurrency: "GBP" }, "EUR", {
      budgetAmount: 6000,
      budgetCurrency: "EUR",
    }),
    { budgetCurrency: "GBP" },
  );
});

test("touchesBudget and needsCurrency gate the extra lookups", () => {
  assert.equal(touchesBudget({}), false);
  assert.equal(touchesBudget({ estimatedHours: null }), true);
  assert.equal(needsCurrency({ estimatedHours: 80 }), false);
  assert.equal(needsCurrency({ budgetAmount: null }), true);
  assert.equal(needsCurrency({ budgetCurrency: "EUR" }), true);
});
