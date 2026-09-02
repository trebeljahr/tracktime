import { describe, expect, it } from "vitest";
import { computeBudgetProgress, formatDurationShort } from "@starter/shared";

import {
  budgetView,
  formatHoursTarget,
  type BudgetFormatters,
} from "./budget-view";

const HOUR = 3600;

/** Deliberately not Intl — the assertions are about the view, not the locale. */
const fmt: BudgetFormatters = {
  durationShort: formatDurationShort,
  money: (amount, currency) => `${currency} ${amount.toFixed(2)}`,
  fallbackCurrency: "EUR",
};

const entry = (seconds: number, hourlyRate = 60, currency = "EUR") => ({
  seconds,
  billable: true,
  hourlyRate,
  currency,
});

describe("budgetView", () => {
  it("renders nothing at all when no target is set", () => {
    expect(budgetView(null, fmt)).toBeNull();
    expect(budgetView(undefined, fmt)).toBeNull();

    const untargeted = computeBudgetProgress(
      { estimatedHours: null, budgetAmount: null, budgetCurrency: null },
      [entry(10 * HOUR)],
    );
    // Tracked time exists, but there is nothing to measure it against — the
    // cell stays empty rather than reading "0% of 0".
    expect(budgetView(untargeted, fmt)).toBeNull();
  });

  it("reads hours as tracked-of-estimate with a remainder", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 80, budgetAmount: null, budgetCurrency: null },
        [entry(62 * HOUR)],
      ),
      fmt,
    );

    expect(view?.hours).toEqual({
      label: "62h 0m of 80h",
      percentLabel: "78%",
      fill: 77.5,
      remainderLabel: "18h 0m left",
      status: "under",
    });
    expect(view?.amount).toBeNull();
    expect(view?.badge).toBeNull();
  });

  it("reads money in the budget's own currency", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: null, budgetAmount: 6000, budgetCurrency: "EUR" },
        [entry(62 * HOUR, 75)],
      ),
      fmt,
    );

    expect(view?.amount?.label).toBe("EUR 4650.00 of EUR 6000.00");
    expect(view?.amount?.percentLabel).toBe("78%");
    expect(view?.amount?.remainderLabel).toBe("EUR 1350.00 left");
    expect(view?.hours).toBeNull();
  });

  it("flags a budget that is nearly used up", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
        [entry(9 * HOUR)],
      ),
      fmt,
    );

    expect(view?.status).toBe("near");
    expect(view?.badge).toBe("Nearly used up");
    expect(view?.hours?.percentLabel).toBe("90%");
  });

  it("flags an overrun without letting the bar overflow its track", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
        [entry(13 * HOUR)],
      ),
      fmt,
    );

    expect(view?.status).toBe("over");
    expect(view?.badge).toBe("Over budget");
    expect(view?.hours?.percentLabel).toBe("130%");
    expect(view?.hours?.fill).toBe(100);
    expect(view?.hours?.remainderLabel).toBe("3h 0m over");
  });

  it("takes the worse of the two targets for the row's signal", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 100, budgetAmount: 100, budgetCurrency: "EUR" },
        [entry(2 * HOUR)],
      ),
      fmt,
    );

    expect(view?.hours?.status).toBe("under");
    expect(view?.amount?.status).toBe("over");
    expect(view?.status).toBe("over");
    expect(view?.badge).toBe("Over budget");
  });

  it("says which currencies were left out instead of summing them in", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: null, budgetAmount: 1000, budgetCurrency: "EUR" },
        [entry(5 * HOUR, 60, "EUR"), entry(5 * HOUR, 100, "USD")],
      ),
      fmt,
    );

    expect(view?.amount?.label).toBe("EUR 300.00 of EUR 1000.00");
    expect(view?.currencyNote).toBe(
      "Excludes USD tracked before the workspace currency changed.",
    );
  });

  it("refuses to pick a currency when there is no budget to anchor one", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
        [entry(1 * HOUR, 60, "EUR"), entry(1 * HOUR, 100, "USD")],
      ),
      fmt,
    );

    // Listed biggest first, the same order the roll-up produces.
    expect(view?.currencyNote).toBe(
      "Tracked in USD and EUR. Amounts are never summed across currencies.",
    );
    // The hours side is currency-free and keeps working.
    expect(view?.hours?.percentLabel).toBe("20%");
  });

  it("treats a target of zero as a real, already-exceeded target", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 0, budgetAmount: 0, budgetCurrency: "EUR" },
        [entry(1 * HOUR)],
      ),
      fmt,
    );

    expect(view).not.toBeNull();
    expect(view?.hours?.percentLabel).toBe("100%");
    expect(view?.hours?.label).toBe("1h 0m of 0h");
    expect(view?.status).toBe("over");
  });

  it("shows a target with nothing tracked as empty, not as missing", () => {
    const view = budgetView(
      computeBudgetProgress(
        { estimatedHours: 40, budgetAmount: null, budgetCurrency: null },
        [],
      ),
      fmt,
    );

    expect(view?.hours?.percentLabel).toBe("0%");
    expect(view?.hours?.fill).toBe(0);
    expect(view?.badge).toBeNull();
  });
});

describe("formatHoursTarget", () => {
  it("reads as hours, trimming the noise off round numbers", () => {
    expect(formatHoursTarget(80)).toBe("80h");
    expect(formatHoursTarget(7.5)).toBe("7.5h");
    expect(formatHoursTarget(7.25)).toBe("7.25h");
    expect(formatHoursTarget(0)).toBe("0h");
  });
});
