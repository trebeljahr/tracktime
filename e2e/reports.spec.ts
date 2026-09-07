import { test, expect, type Locator } from "@playwright/test";
import { logManualEntry, signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

const PROJECT_NAME = "Reporting rig";

/** Two manual blocks of exactly one hour and exactly thirty minutes. */
const FIRST_DURATION = "1:00:00";
const SECOND_DURATION = "0:30:00";
const TOTAL_DURATION = "1:30:00";

let sequence = 0;

function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

/** Local "YYYY-MM-DD", `offsetDays` away from today. */
function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

/**
 * Report filters live in the query string, so pinning the range there keeps
 * the assertions independent of today's weekday and of the workspace's
 * week-start preference.
 */
const RANGE_QUERY = `?from=${dayKey(-7)}&to=${dayKey(1)}`;

/**
 * Read the opaque id out of a `<prefix><id>` test id, once it has settled —
 * an optimistic row carries a placeholder id that a later assertion would
 * chase.
 */
async function idFromTestId(row: Locator, prefix: string): Promise<string> {
  await expect
    .poll(
      async () => (await row.getAttribute("data-testid"))?.slice(prefix.length),
      { message: `expected a settled ${prefix}<id> test id` }
    )
    .not.toMatch(/^optimistic-/);

  const testId = await row.getAttribute("data-testid");
  expect(testId, `expected a ${prefix}<id> test id`).not.toBeNull();
  return (testId ?? "").slice(prefix.length);
}

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("Reports", () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaUI(page, {
      name: "Reports User",
      email: uniqueEmail("reports"),
      password: PASSWORD,
    });

    await page.goto("/track");
    await expect(page.getByTestId("track-page")).toBeVisible();
    await expect(page.getByTestId("entries-empty")).toBeVisible();

    // Create the project straight from the tracker's picker, then track
    // against it.
    await page.getByTestId("tracker-project").click();
    await page.getByTestId("combobox-search").fill(PROJECT_NAME);
    await page.getByTestId("combobox-create").click();
    await expect(page.getByTestId("tracker-project")).toContainText(
      PROJECT_NAME
    );

    await logManualEntry(page, "Report groundwork", FIRST_DURATION);
    await logManualEntry(page, "Report polish", SECOND_DURATION);

    // Nothing may be running: a live entry would make the report totals move
    // between assertions.
    await expect(
      page.locator('[data-testid="entry-row"][data-running="true"]')
    ).toHaveCount(0);
  });

  test("summary totals the tracked time and groups it", async ({ page }) => {
    await page.goto(`/reports/summary${RANGE_QUERY}`);
    await expect(page.getByTestId("summary-report")).toBeVisible();

    // Headline figures match the two entries exactly.
    await expect(page.getByTestId("kpi-total")).toHaveText(TOTAL_DURATION);
    await expect(page.getByTestId("kpi-non-billable")).toBeVisible();

    // Default grouping is by project.
    await expect(page.getByTestId("groupby-project")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const summaryRows = page.locator('[data-testid^="summary-row-"]');
    await expect(summaryRows).toHaveCount(1);
    await expect(summaryRows.first()).toContainText(PROJECT_NAME);
    await expect(summaryRows.first()).toContainText(TOTAL_DURATION);

    await expect(page.getByTestId("summary-total-duration")).toHaveText(
      TOTAL_DURATION
    );
    await expect(page.getByTestId("summary-empty")).toHaveCount(0);

    // Switching the dimension re-groups the same time without losing any.
    await page.getByTestId("groupby-client").click();
    await expect(page.getByTestId("groupby-client")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page).toHaveURL(/group=client/);
    await expect(summaryRows).toHaveCount(1);
    // The project has no client, so everything rolls up under the fallback.
    await expect(summaryRows.first()).toContainText("No client");
    await expect(page.getByTestId("summary-total-duration")).toHaveText(
      TOTAL_DURATION
    );

    // …and switching back lists the project again.
    await page.getByTestId("groupby-project").click();
    await expect(summaryRows.first()).toContainText(PROJECT_NAME);
    await expect(page.getByTestId("summary-total-duration")).toHaveText(
      TOTAL_DURATION
    );
  });

  test("creates and renames a client from the filter bar", async ({ page }) => {
    await page.goto(`/reports/summary${RANGE_QUERY}`);
    await expect(page.getByTestId("report-filters")).toBeVisible();

    // ── create one, without leaving the report ──────────────────────
    await page.getByTestId("filter-clients").click();
    await page.getByTestId("filter-clients-new").click();

    const dialog = page.getByTestId("client-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("client-name-input").fill("Filter Bar Co");
    await page.getByTestId("client-submit").click();
    await expect(dialog).toBeHidden();

    // It lands in the very list it was created from.
    await page.getByTestId("filter-clients").click();
    const option = page
      .locator('[data-testid^="filter-clients-option-"]')
      .filter({ hasText: "Filter Bar Co" });
    await expect(option).toHaveCount(1);
    const clientId = await idFromTestId(option, "filter-clients-option-");

    // ── and the pencil edits it, rather than ticking the filter ─────
    await page.getByTestId(`filter-clients-edit-${clientId}`).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("client-name-input")).toHaveValue(
      "Filter Bar Co"
    );
    await page.getByTestId("client-name-input").fill("Filter Bar Ltd");
    await page.getByTestId("client-submit").click();
    await expect(dialog).toBeHidden();

    // The pencil is not a selection: no client filter reached the URL.
    await expect(page).not.toHaveURL(/clients=/);
    await expect(page.getByTestId("summary-total-duration")).toHaveText(
      TOTAL_DURATION
    );

    await page.getByTestId("filter-clients").click();
    await expect(
      page.getByTestId(`filter-clients-option-${clientId}`)
    ).toContainText("Filter Bar Ltd");
  });

  test("detailed lists every entry in the range", async ({ page }) => {
    await page.goto(`/reports/detailed${RANGE_QUERY}`);
    await expect(page.getByTestId("detailed-report")).toBeVisible();
    await expect(page.getByTestId("detailed-table")).toBeVisible();

    const rows = page.locator('[data-testid^="detailed-row-"]');
    await expect(rows).toHaveCount(2);

    await expect(page.getByTestId("kpi-entries")).toHaveText("2");
    await expect(page.getByTestId("kpi-total")).toHaveText(TOTAL_DURATION);
    await expect(page.getByTestId("detailed-empty")).toHaveCount(0);
    await expect(page.getByTestId("detailed-load-more")).toHaveCount(0);

    await expect(page.getByTestId("detailed-table")).toContainText(
      "Report groundwork"
    );
    await expect(page.getByTestId("detailed-table")).toContainText(
      "Report polish"
    );
    await expect(page.getByTestId("detailed-table")).toContainText(
      PROJECT_NAME
    );

    // Narrowing to a range with no tracked time empties the log rather than
    // showing stale rows.
    await page.goto(`/reports/detailed?from=${dayKey(-30)}&to=${dayKey(-20)}`);
    await expect(page.getByTestId("detailed-empty")).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("kpi-total")).toHaveText("0:00:00");
  });
});
