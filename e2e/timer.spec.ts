import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

let sequence = 0;

/** Unique per test — signup is rejected for an address that already exists. */
function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

/** The tracker row whose description contains `description`. */
function entryRow(page: Page, description: string): Locator {
  return page
    .locator('[data-testid="entry-row"]')
    .filter({ hasText: description });
}

/** Every row that the list currently renders as still running. */
function runningRows(page: Page): Locator {
  return page.locator('[data-testid="entry-row"][data-running="true"]');
}

/** Sign up a fresh user and land on the tracker with the list settled. */
async function openTracker(page: Page, prefix: string): Promise<void> {
  await signUpViaUI(page, {
    name: "Timer User",
    email: uniqueEmail(prefix),
    password: PASSWORD,
  });
  await page.goto("/track");
  await expect(page.getByTestId("track-page")).toBeVisible();
  await expect(page.getByTestId("tracker-bar")).toBeVisible();
  // A fresh account has nothing tracked — waiting for the empty state proves
  // `entries.list` resolved before the test starts clicking.
  await expect(page.getByTestId("entries-empty")).toBeVisible();
}

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("Timer", () => {
  test("starts, ticks and stops into the day list", async ({ page }) => {
    await openTracker(page, "timer-basic");

    await page.getByTestId("tracker-description").fill("Writing the spec");
    await page.getByTestId("tracker-toggle").click();

    // Running: the bar flips to Stop and the elapsed clock goes live.
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "running",
    );
    await expect(page.getByTestId("tracker-elapsed")).toHaveAttribute(
      "data-running",
      "true",
    );
    await expect(page.getByTestId("tracker-elapsed")).toHaveText(
      /^0:00:(?:0[1-9]|[1-5]\d)$/,
      { timeout: 15_000 },
    );

    // …and exactly one row in the list is the running one.
    await expect(runningRows(page)).toHaveCount(1);
    await expect(
      runningRows(page).getByTestId("entry-description"),
    ).toHaveText("Writing the spec");
    await expect(runningRows(page).getByTestId("entry-end")).toHaveText("now");

    await page.getByTestId("tracker-toggle").click();

    // Stopped: nothing is running any more and the entry sits under Today.
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "idle",
    );
    await expect(page.getByTestId("tracker-elapsed")).toHaveAttribute(
      "data-running",
      "false",
    );
    await expect(runningRows(page)).toHaveCount(0);

    const row = entryRow(page, "Writing the spec");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-running", "false");
    // A handful of seconds of wall clock — never zero, never an hour.
    await expect(row.getByTestId("entry-duration")).toHaveValue(
      /^0:00:(?:0[1-9]|[1-5]\d)$/,
    );

    const day = page.getByTestId("day-group").first();
    await expect(day.getByTestId("day-label")).toHaveText("Today");
    await expect(day.getByTestId("day-total")).toHaveText(
      /^0:00:(?:0[1-9]|[1-5]\d)$/,
    );
  });

  test("keeps at most one timer running", async ({ page }) => {
    await openTracker(page, "timer-invariant");

    // A finished entry to come back to later.
    await page.getByTestId("tracker-description").fill("First task");
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(1);
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(0);
    await expect(entryRow(page, "First task")).toHaveCount(1);

    // Second timer.
    await page.getByTestId("tracker-description").fill("Second task");
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(1);
    await expect(
      runningRows(page).getByTestId("entry-description"),
    ).toHaveText("Second task");

    // Continuing the first entry starts a third timer, which must stop the
    // second one rather than run alongside it.
    await entryRow(page, "First task").getByTestId("entry-continue").click();

    await expect(runningRows(page)).toHaveCount(1);
    await expect(
      runningRows(page).getByTestId("entry-description"),
    ).toHaveText("First task");
    await expect(page.getByTestId("tracker-description")).toHaveValue(
      "First task",
    );

    // The interrupted timer kept its time and is no longer live.
    const second = entryRow(page, "Second task");
    await expect(second).toHaveCount(1);
    await expect(second).toHaveAttribute("data-running", "false");
    await expect(second.getByTestId("entry-duration")).toHaveValue(
      /^0:00:\d{2}$/,
    );

    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(0);
  });

  test("logs a manual entry with an explicit duration", async ({ page }) => {
    await openTracker(page, "timer-manual");

    await page.getByTestId("tracker-mode-manual").click();

    // Manual mode swaps the live clock for a start/end range, pre-filled with
    // the last hour.
    await expect(page.getByTestId("tracker-start-time")).toBeVisible();
    await expect(page.getByTestId("tracker-end-time")).toBeVisible();
    await expect(page.getByTestId("tracker-duration")).toHaveValue("1:00:00");
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "add",
    );

    await page.getByTestId("tracker-description").fill("Manual block");
    // The duration field accepts tracker shorthand and normalises it.
    await page.getByTestId("tracker-duration").fill("45m");
    await page.getByTestId("tracker-duration").press("Enter");
    await expect(page.getByTestId("tracker-duration")).toHaveValue("0:45:00");

    await page.getByTestId("tracker-toggle").click();

    const row = entryRow(page, "Manual block");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-running", "false");
    await expect(row.getByTestId("entry-duration")).toHaveValue("0:45:00");

    // Adding resets the composer for the next block without starting a timer.
    await expect(page.getByTestId("tracker-description")).toHaveValue("");
    await expect(page.getByTestId("tracker-duration")).toHaveValue("1:00:00");
    await expect(runningRows(page)).toHaveCount(0);
  });
});
