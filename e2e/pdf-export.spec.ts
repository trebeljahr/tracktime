import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

const PROJECT_NAME = "PDF export rig";
const ENTRY_DESCRIPTION = "Something worth printing";
const ENTRY_DURATION = "1:00:00";

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Pinning the range in the query string keeps the export independent of
 * today's weekday and of the workspace's week-start preference.
 */
const RANGE_QUERY = `?from=${dayKey(-7)}&to=${dayKey(1)}`;

/**
 * Log one manual entry from the tracker bar and wait for its row to land.
 *
 * The duration field anchors the end to the pre-filled start, so the report
 * has real tracked seconds in it rather than a wall-clock sliver.
 */
async function logManualEntry(
  page: Page,
  description: string,
  duration: string,
): Promise<void> {
  await page.getByTestId("tracker-manual-open").click();
  await page.getByTestId("manual-entry-description").fill(description);
  await page.getByTestId("manual-entry-duration").fill(duration);
  await page.getByTestId("manual-entry-duration").press("Enter");
  await expect(page.getByTestId("manual-entry-duration")).toHaveValue(duration);

  await page.getByTestId("manual-entry-add").click();

  const row = page
    .locator('[data-testid="entry-row"]')
    .filter({ hasText: description });
  await expect(row).toHaveCount(1);
  // Wait for the server's real id before moving on. The row renders first with
  // the optimistic "temp-<id>" while `entries.create` is still in flight, and
  // navigating during that window aborts the request — which the offline queue
  // reads as a failure and replays, landing a duplicate entry.
  await expect
    .poll(async () => (await row.getAttribute("data-entry-id")) ?? "", {
      message: "expected the entry row to settle to its server id",
    })
    .not.toMatch(/^temp-/);
  await expect(row.getByTestId("entry-duration")).toHaveValue(duration);
}

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("PDF export", () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaUI(page, {
      name: "PDF User",
      email: uniqueEmail("pdf"),
      password: PASSWORD,
    });

    await page.goto("/track");
    await expect(page.getByTestId("track-page")).toBeVisible();
    await expect(page.getByTestId("entries-empty")).toBeVisible();

    await page.getByTestId("tracker-project").click();
    await page.getByTestId("combobox-search").fill(PROJECT_NAME);
    await page.getByTestId("combobox-create").click();
    await expect(page.getByTestId("tracker-project")).toContainText(
      PROJECT_NAME,
    );

    await logManualEntry(page, ENTRY_DESCRIPTION, ENTRY_DURATION);
  });

  test("downloads a real PDF of the summary report", async ({ page }) => {
    await page.goto(`/reports/summary${RANGE_QUERY}`);
    await expect(page.getByTestId("summary-report")).toBeVisible();
    // The button stays disabled until the report has answered; clicking before
    // that would open nothing.
    await expect(page.getByTestId("report-export")).toBeEnabled();

    await page.getByTestId("report-export").click();
    await expect(page.getByTestId("report-export-menu")).toBeVisible();

    // The download is started from a blob url built in the page, so the event
    // has to be awaited alongside the click rather than after it.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByTestId("report-export-pdf").click(),
    ]);

    // Same naming rule as the CSV export (`csvFilename` in services/csv.ts):
    // "tracktime-<report>-<from>_<to>", only with a .pdf suffix. Asserted with
    // the range in it, so a filename that silently lost the dates still fails.
    expect(download.suggestedFilename()).toMatch(
      /^tracktime-summary-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/,
    );

    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path as string);

    // A PDF is only a PDF if it starts with the header — a JSON error page or a
    // base64 string that never got decoded would both fail here.
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Non-trivial size: an empty or truncated render would be a few hundred bytes.
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    // pdfkit closes the file with the EOF marker; its presence means the whole
    // document reached the browser, not just the first chunk.
    expect(bytes.subarray(-1024).toString("latin1")).toContain("%%EOF");
  });

  test("the print item is gone — the PDF is server-rendered now", async ({
    page,
  }) => {
    await page.goto(`/reports/summary${RANGE_QUERY}`);
    await expect(page.getByTestId("summary-report")).toBeVisible();

    await page.getByTestId("report-export").click();
    await expect(page.getByTestId("report-export-menu")).toBeVisible();
    await expect(page.getByTestId("report-export-csv")).toBeVisible();
    await expect(page.getByTestId("report-export-pdf")).toBeVisible();
    await expect(page.getByTestId("report-export-print")).toHaveCount(0);
  });
});
