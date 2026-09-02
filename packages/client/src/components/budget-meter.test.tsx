// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeBudgetProgress, formatDurationShort } from "@starter/shared";

import { budgetView, type BudgetFormatters } from "@/lib/budget-view";
import { BudgetMeterCell } from "./budget-meter";

const HOUR = 3600;

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

const renderCell = (
  progress: Parameters<typeof budgetView>[0],
  emptyLabel?: string,
): void => {
  render(
    <BudgetMeterCell
      view={budgetView(progress, fmt)}
      {...(emptyLabel === undefined ? {} : { emptyLabel })}
      testId="budget"
    />,
  );
};

afterEach(cleanup);

describe("BudgetMeterCell", () => {
  it("renders the empty label, and no bar at all, without a target", () => {
    renderCell(
      computeBudgetProgress(
        { estimatedHours: null, budgetAmount: null, budgetCurrency: null },
        [entry(10 * HOUR)],
      ),
      "No budget",
    );

    expect(screen.getByTestId("budget").textContent).toBe("No budget");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("draws one bar per target, filled to the ratio", () => {
    renderCell(
      computeBudgetProgress(
        { estimatedHours: 80, budgetAmount: 6000, budgetCurrency: "EUR" },
        [entry(62 * HOUR, 75)],
      ),
    );

    expect(screen.getByTestId("budget-hours").textContent).toContain(
      "62h 0m of 80h",
    );
    expect(screen.getByTestId("budget-hours-percent").textContent).toBe("78%");
    expect(screen.getByTestId("budget-amount").textContent).toContain(
      "EUR 4650.00 of EUR 6000.00",
    );

    const [hours, amount] = screen.getAllByRole("progressbar");
    expect(hours?.getAttribute("aria-valuenow")).toBe("78");
    expect(amount?.getAttribute("aria-valuenow")).toBe("78");
    expect(screen.queryByTestId("budget-badge")).toBeNull();
  });

  it("shows a badge and a clamped bar once the budget is blown", () => {
    renderCell(
      computeBudgetProgress(
        { estimatedHours: 10, budgetAmount: null, budgetCurrency: null },
        [entry(13 * HOUR)],
      ),
    );

    const badge = screen.getByTestId("budget-badge");
    expect(badge.textContent).toContain("Over budget");
    expect(badge.getAttribute("data-status")).toBe("over");
    expect(screen.getByTestId("budget-hours-percent").textContent).toBe("130%");

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-valuetext")).toBe("130% — 3h 0m over");
  });

  it("warns rather than sums when the project spans two currencies", () => {
    renderCell(
      computeBudgetProgress(
        { estimatedHours: null, budgetAmount: 1000, budgetCurrency: "EUR" },
        [entry(5 * HOUR, 60, "EUR"), entry(5 * HOUR, 100, "USD")],
      ),
    );

    expect(screen.getByTestId("budget-currency-note").textContent).toContain(
      "Excludes USD",
    );
    // The 800 a naive sum would produce appears nowhere on screen.
    expect(screen.getByTestId("budget").textContent).toContain(
      "EUR 300.00 of EUR 1000.00",
    );
    expect(screen.getByTestId("budget").textContent).not.toContain("800");
  });

  it("renders a target with no time tracked as an empty bar, not as absent", () => {
    renderCell(
      computeBudgetProgress(
        { estimatedHours: 40, budgetAmount: null, budgetCurrency: null },
        [],
      ),
    );

    expect(screen.getByTestId("budget-hours-percent").textContent).toBe("0%");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "0",
    );
  });
});
