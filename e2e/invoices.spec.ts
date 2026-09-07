import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

const CLIENT_NAME = "Northwind";
const PROJECT_NAME = "Billable build";
/** A round rate, so every amount in here is a round number. */
const PROJECT_RATE = "100";

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
 * The billed range every invoice in this file uses: a week back to tomorrow,
 * so nothing here depends on today's weekday or on the month boundary.
 */
const RANGE_FROM = dayKey(-7);
const RANGE_TO = dayKey(1);

/**
 * Money is rendered through `Intl.NumberFormat`, so the decimal separator
 * depends on the runner's locale. Match the digits, not the punctuation.
 */
const money = (whole: number): RegExp => new RegExp(`${whole}[.,]00`);

/**
 * Read the entity id out of a row's `data-testid`.
 *
 * Rows appear first as an optimistic placeholder whose id is a client-side
 * "optimistic-<uuid>", then get replaced when the server responds with the
 * real document. Reading the placeholder id yields locators that stop matching
 * a moment later, so wait for the real id before returning it.
 */
async function idFromTestId(row: Locator, prefix: string): Promise<string> {
  await expect
    .poll(
      async () => (await row.getAttribute("data-testid"))?.slice(prefix.length),
      { message: `expected a settled ${prefix}<id> test id` },
    )
    .not.toMatch(/^optimistic-/);

  const testId = await row.getAttribute("data-testid");
  expect(testId, `expected a ${prefix}<id> test id`).not.toBeNull();
  return (testId ?? "").slice(prefix.length);
}

/** Pick an option out of an open-on-click combobox by its visible label. */
async function pickComboboxOption(
  page: Page,
  triggerTestId: string,
  label: string,
): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByTestId("combobox-search").fill(label);
  await page
    .locator('[data-testid^="combobox-option-"]')
    .filter({ hasText: label })
    .first()
    .click();
}

/**
 * Create the client and the project that carries the rate.
 *
 * The rate matters more than anything else in this setup: it is SNAPSHOTTED
 * onto every entry as it stops, and an entry with no rate can never be
 * invoiced at all.
 */
async function createClientAndProject(page: Page): Promise<void> {
  await page.goto("/projects");
  await expect(page.getByTestId("projects-page")).toBeVisible();

  await page.getByTestId("new-project").click();
  await expect(page.getByTestId("project-dialog")).toBeVisible();

  await page.getByTestId("project-name-input").fill(PROJECT_NAME);

  // Coin the client from inside the project form — there is no separate
  // "new client" screen to detour through.
  await page.getByTestId("project-client-combobox").click();
  await page.getByTestId("combobox-search").fill(CLIENT_NAME);
  await page.getByTestId("combobox-create").click();
  await expect(page.getByTestId("project-client-combobox")).toContainText(
    CLIENT_NAME,
  );

  await page.getByTestId("project-advanced-toggle").click();
  await page.getByTestId("project-rate-input").fill(PROJECT_RATE);
  await page.getByTestId("project-submit").click();
  await expect(page.getByTestId("project-dialog")).toBeHidden();

  const row = page
    .locator('[data-testid^="project-row-"]')
    .filter({ hasText: PROJECT_NAME });
  await expect(row).toHaveCount(1);
  await idFromTestId(row, "project-row-");
}

/**
 * Log one billable entry from the tracker bar.
 *
 * The duration field anchors the end to the pre-filled start, so the billed
 * seconds are exact rather than wall-clock — an invoice assertion cannot
 * afford a stopwatch's worth of slop.
 */
async function trackBillableHours(
  page: Page,
  description: string,
  duration: string,
): Promise<void> {
  await page.goto("/track");
  await expect(page.getByTestId("track-page")).toBeVisible();

  await pickComboboxOption(page, "tracker-project", PROJECT_NAME);
  await expect(page.getByTestId("tracker-billable")).toHaveAttribute(
    "data-billable",
    "true",
  );

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

/** Open the create dialog and fill in client + range, stopping at the preview. */
async function openPreview(page: Page): Promise<void> {
  await page.goto("/invoices");
  await expect(page.getByTestId("invoices-page")).toBeVisible();

  await page.getByTestId("new-invoice").click();
  await expect(page.getByTestId("invoice-dialog")).toBeVisible();

  await pickComboboxOption(page, "invoice-client-combobox", CLIENT_NAME);

  await page.getByTestId("invoice-range").click();
  await expect(page.getByTestId("invoice-range-content")).toBeVisible();
  await page.getByTestId("invoice-range-from").fill(RANGE_FROM);
  await page.getByTestId("invoice-range-to").fill(RANGE_TO);
  // Escape dismisses the topmost layer — the range popover — and must leave
  // the dialog under it standing.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("invoice-range-content")).toBeHidden();
  await expect(page.getByTestId("invoice-dialog")).toBeVisible();
}

/**
 * Commit the previewed invoice.
 *
 * Creating is deliberately two clicks: the first opens a confirmation strip
 * that restates the money, the second writes. Previewing must never be able
 * to bill anything by accident.
 */
async function confirmCreate(page: Page): Promise<void> {
  await page.getByTestId("invoice-create").click();
  await expect(page.getByTestId("invoice-create-confirm-panel")).toBeVisible();
  await page.getByTestId("invoice-create-confirm").click();
  await expect(page.getByTestId("invoice-dialog")).toBeHidden();
}

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("Invoicing", () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaUI(page, {
      name: "Invoice User",
      email: uniqueEmail("invoices"),
      password: PASSWORD,
    });
    await createClientAndProject(page);
  });

  test("bills tracked time once, and never a second time", async ({ page }) => {
    await trackBillableHours(page, "Foundations", "3:00:00");

    // ── preview: three hours at 100 ─────────────────────────────────
    await openPreview(page);

    const previewLines = page.getByTestId("invoice-preview-line");
    await expect(previewLines).toHaveCount(1);
    await expect(previewLines.first()).toContainText(PROJECT_NAME);
    await expect(previewLines.first()).toContainText("3.00 h");
    await expect(previewLines.first()).toContainText(money(300));
    await expect(page.getByTestId("invoice-preview-subtotal")).toContainText(
      money(300),
    );
    await expect(page.getByTestId("invoice-preview-total")).toContainText(
      money(300),
    );
    // Nothing has been billed yet, so nothing is excluded.
    await expect(page.getByTestId("invoice-preview-skipped-invoiced")).toHaveCount(
      0,
    );

    await confirmCreate(page);

    // ── the document ────────────────────────────────────────────────
    const detail = page.getByTestId("invoice-detail");
    await expect(detail).toBeVisible();
    await expect(page.getByTestId("invoice-detail-client")).toContainText(
      CLIENT_NAME,
    );
    await expect(page.getByTestId("invoice-detail-status")).toHaveText("draft");
    await expect(page.getByTestId("invoice-detail-line")).toHaveCount(1);
    await expect(page.getByTestId("invoice-detail-line").first()).toContainText(
      "3.00 h",
    );
    await expect(page.getByTestId("invoice-detail-total")).toContainText(
      money(300),
    );
    await expect(page.getByTestId("invoices-count")).toHaveText("1 invoice");

    // ── THE POINT: the same range cannot be billed again ────────────
    //
    // Every hour in the range is now on an invoice, so a second attempt over
    // exactly the same dates must find nothing to bill — and must say WHY,
    // rather than looking broken or, far worse, quietly billing 300 twice.
    await openPreview(page);
    await expect(page.getByTestId("invoice-preview-empty")).toBeVisible();
    await expect(page.getByTestId("invoice-preview-empty")).toContainText(
      "already been invoiced",
    );
    await expect(
      page.getByTestId("invoice-preview-skipped-invoiced"),
    ).toBeVisible();
    await expect(page.getByTestId("invoice-preview-line")).toHaveCount(0);
    // The irreversible button is not merely hidden behind a confirmation —
    // there is nothing it could legally do, so it is disabled outright.
    await expect(page.getByTestId("invoice-create")).toBeDisabled();
    await page.getByTestId("invoice-cancel").click();
    await expect(page.getByTestId("invoice-dialog")).toBeHidden();

    // ── new time in the same range bills, the old time still does not ──
    await trackBillableHours(page, "Follow-up", "1:00:00");
    await openPreview(page);

    await expect(page.getByTestId("invoice-preview-line")).toHaveCount(1);
    await expect(page.getByTestId("invoice-preview-line").first()).toContainText(
      "1.00 h",
    );
    // 100, not 400: the three invoiced hours are still excluded.
    await expect(page.getByTestId("invoice-preview-total")).toContainText(
      money(100),
    );
    await expect(
      page.getByTestId("invoice-preview-skipped-invoiced"),
    ).toBeVisible();

    await confirmCreate(page);

    await expect(page.getByTestId("invoices-count")).toHaveText("2 invoices");
    const totals = page.locator('[data-testid^="invoice-total-"]');
    await expect(totals).toHaveCount(2);
    // Four tracked hours have been billed as 300 + 100. Any double billing
    // would show up here as a 400 or a second 300.
    await expect(totals.filter({ hasText: money(300) })).toHaveCount(1);
    await expect(totals.filter({ hasText: money(100) })).toHaveCount(1);
    await expect(totals.filter({ hasText: money(400) })).toHaveCount(0);
  });

  test("deleting a draft makes its time billable again", async ({ page }) => {
    await trackBillableHours(page, "Foundations", "3:00:00");
    await openPreview(page);
    await confirmCreate(page);

    await expect(page.getByTestId("invoice-detail-total")).toContainText(
      money(300),
    );

    await page.getByTestId("invoice-delete").click();
    await expect(page.getByTestId("invoice-delete-dialog")).toBeVisible();
    await page.getByTestId("confirm-accept").click();

    await expect(page.getByTestId("invoice-detail")).toHaveCount(0);
    await expect(page.getByTestId("invoices-empty")).toBeVisible();

    // The counterpart of the double-billing guard: releasing the invoice must
    // release the time with it, or those hours would be billable nowhere.
    await openPreview(page);
    await expect(page.getByTestId("invoice-preview-line")).toHaveCount(1);
    await expect(page.getByTestId("invoice-preview-total")).toContainText(
      money(300),
    );
    await expect(page.getByTestId("invoice-preview-skipped-invoiced")).toHaveCount(
      0,
    );
  });

  test("walks draft → sent → paid and closes the door behind it", async ({
    page,
  }) => {
    await trackBillableHours(page, "Foundations", "3:00:00");
    await openPreview(page);
    await confirmCreate(page);

    // A draft is the only state that can be deleted, and the only forward
    // step offered is "sent" — never straight to paid.
    await expect(page.getByTestId("invoice-delete")).toBeVisible();
    await expect(page.getByTestId("invoice-status-set-paid")).toHaveCount(0);

    await page.getByTestId("invoice-status-set-sent").click();
    await expect(page.getByTestId("invoice-detail-status")).toHaveText("sent");
    // Sent has left the building: it is a record now, not a deletable draft.
    await expect(page.getByTestId("invoice-delete")).toHaveCount(0);
    await expect(page.getByTestId("invoice-status-set-draft")).toBeVisible();

    await page.getByTestId("invoice-status-set-paid").click();
    await expect(page.getByTestId("invoice-detail-status")).toHaveText("paid");
    // A paid invoice walks back one step at a time — never straight to draft.
    await expect(page.getByTestId("invoice-status-set-draft")).toHaveCount(0);
    await expect(page.getByTestId("invoice-status-set-sent")).toBeVisible();
  });
});
