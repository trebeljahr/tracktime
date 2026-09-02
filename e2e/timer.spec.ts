import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

/**
 * The idle test bridge the client installs while idle detection is on.
 *
 * Declared here rather than imported: the spec compiles outside the client
 * package's tsconfig, so its global augmentation is not in scope.
 */
declare global {
  interface Window {
    __tracktimeIdle?: {
      simulate: (
        signal: "active" | "idle" | "locked",
        idleSeconds?: number,
      ) => void;
    };
  }
}

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

  test("pauses when the screen locks and resumes the same work", async ({
    page,
  }) => {
    await openTracker(page, "timer-idle");

    // Configure idle detection: pause and resume, with the shortest threshold
    // the settings allow.
    await page.goto("/settings");
    await page.getByTestId("settings-tab-idle").click();
    await page.getByTestId("idle-enabled").click();
    await expect(page.getByTestId("idle-enabled")).toHaveAttribute(
      "data-state",
      "checked",
    );
    await page.getByTestId("idle-behavior-pause-and-resume").click();
    await expect(
      page.getByTestId("idle-behavior-pause-and-resume"),
    ).toHaveAttribute("data-state", "on");
    await page.getByTestId("idle-threshold").fill("1");
    await page.getByTestId("idle-threshold").press("Enter");
    await expect(page.getByTestId("idle-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );

    await page.goto("/track");
    await page.getByTestId("tracker-description").fill("Reading the RFC");
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(1);

    // The detector is the OS in real life, so the test injects a reading
    // instead of idling for a real minute. `__tracktimeIdle` feeds exactly the
    // signal `chrome.idle` and `powerMonitor` feed — it grants the page
    // nothing it does not already have — and it only exists once idle
    // detection is enabled, which is why the settings come first.
    await expect
      .poll(() =>
        page.evaluate(() => typeof window.__tracktimeIdle?.simulate),
      )
      .toBe("function");

    // A locked screen rather than a silent one, and that is not an arbitrary
    // choice: an `idle` reading is clamped to the running entry's own start,
    // so a timer opened seconds ago can never have been idle long enough to
    // cross even the one-minute minimum threshold — the entry itself is the
    // proof that somebody was at the keyboard. Locking is deliberate, so it
    // skips the threshold (the "Treat a locked screen as away" setting, on by
    // default) and is the only signal a test can raise without burning a real
    // minute of wall clock. The threshold path is covered exhaustively in
    // `core-idle.test.ts`, where the clock is a parameter.
    await page.evaluate(() => window.__tracktimeIdle?.simulate("locked"));

    // Paused: the entry is closed, nothing is running, and the seconds it had
    // before the lock survive — a truncation is clamped to stay after the
    // entry's start, so it can never destroy tracked time.
    await expect(runningRows(page)).toHaveCount(0);
    const paused = entryRow(page, "Reading the RFC").first();
    await expect(paused).toHaveAttribute("data-running", "false");

    // Back at the keyboard: the same work reopens, by itself.
    await page.evaluate(() => window.__tracktimeIdle?.simulate("active"));

    // A resume is two chained writes — close the old entry, open a new one —
    // and the list is briefly inconsistent while `entries.start` is in flight:
    // the optimistic row is on screen before every cache the pause invalidated
    // has caught up, so a count taken in that window can still see the paused
    // row as running. Wait for the new row to carry its server id first.
    const resumed = runningRows(page).first();
    await expect
      .poll(async () => (await resumed.getAttribute("data-entry-id")) ?? "", {
        message: "expected the resumed row to settle to its server id",
        // The optimistic row is there in a frame; the id it settles to comes
        // from the server, which is the slow part under a loaded suite.
        timeout: 15_000,
      })
      .not.toMatch(/^(?:temp-|$)/);

    await expect(runningRows(page)).toHaveCount(1);
    await expect(
      runningRows(page).getByTestId("entry-description"),
    ).toHaveText("Reading the RFC");

    // One session, now two rows: the work before the lock and the work after
    // it. The time spent away is in neither.
    await expect(entryRow(page, "Reading the RFC")).toHaveCount(2);
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

  /**
   * Regression: the running row used to render a Continue button. Clicking it
   * stopped the entry and started an identical copy, so repeatedly pressing it
   * shredded one stretch of work into a pile of few-second fragments instead of
   * doing the obvious thing.
   */
  test("the running row offers Stop, not Continue", async ({ page }) => {
    await openTracker(page, "running-row");

    await page.getByTestId("tracker-description").fill("Long stretch");
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(1);

    const row = runningRows(page).first();
    await expect(row.getByTestId("entry-stop")).toBeVisible();
    await expect(row.getByTestId("entry-continue")).toHaveCount(0);

    // Stopping from the row stops that entry — it must not spawn a second one.
    await row.getByTestId("entry-stop").click();
    await expect(runningRows(page)).toHaveCount(0);
    await expect(entryRow(page, "Long stretch")).toHaveCount(1);
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "idle",
    );

    // And the stopped row goes back to offering Continue.
    await expect(
      entryRow(page, "Long stretch").getByTestId("entry-continue"),
    ).toBeVisible();
  });

  test("the project picker can create a project without typing a name", async ({
    page,
  }) => {
    await openTracker(page, "picker-create");

    // The create surfaces must be reachable from an empty workspace, where
    // there is no existing name to search for.
    await page.getByTestId("tracker-project").click();
    await page.getByTestId("project-picker-new-project").click();

    await expect(page.getByTestId("project-dialog")).toBeVisible();
    await page.getByTestId("project-name-input").fill("Dropdown Project");
    await page.getByTestId("project-submit").click();

    // Creating from the picker selects the new project straight away.
    await expect(page.getByTestId("tracker-project")).toContainText(
      "Dropdown Project",
    );
  });

  /**
   * A stray click on Start leaves a few-second entry cluttering the day. The
   * toast offers to discard it — but never does so on its own, because
   * silently deleting tracked time is the worse failure.
   */
  test("a short entry offers to be discarded, and is kept if ignored", async ({
    page,
  }) => {
    await openTracker(page, "short-entry");

    await page.getByTestId("tracker-description").fill("Stray click");
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(1);
    await page.getByTestId("tracker-toggle").click();
    await expect(runningRows(page)).toHaveCount(0);

    // Ignoring the offer keeps the entry.
    const discard = page.getByRole("button", { name: "Discard" });
    await expect(discard).toBeVisible();
    await expect(entryRow(page, "Stray click")).toHaveCount(1);

    await discard.click();
    await expect(entryRow(page, "Stray click")).toHaveCount(0);
    await expect(page.getByTestId("entries-empty")).toBeVisible();
  });
});

/**
 * An entry keeps the clock time it was recorded at, wherever it is later opened
 * from. Rico moves between zones (travel, VPN), and the failure this prevents
 * is silent: the entry looks fine, it has just quietly moved by the offset.
 */
test.describe("Recorded time zone", () => {
  const API = `http://127.0.0.1:${process.env.E2E_SERVER_PORT ?? "49761"}`;

  test("shows and edits a foreign-zone entry in the zone it was recorded in", async ({
    page,
  }) => {
    await openTracker(page, "entry-zone");

    // 09:00-10:00 in Tokyo on 2026-08-21 — which is 00:00-01:00 UTC, and would
    // read as some other hour entirely in the browser's own zone.
    const created = await page.request.post(
      `${API}/api/trpc/entries.create?batch=1`,
      {
        data: {
          "0": {
            description: "Standup in Tokyo",
            start: "2026-08-21T00:00:00.000Z",
            end: "2026-08-21T01:00:00.000Z",
            billable: false,
            timeZone: "Asia/Tokyo",
          },
        },
      },
    );
    expect(created.ok()).toBe(true);

    await page.goto("/track");
    const row = entryRow(page, "Standup in Tokyo");
    await expect(row).toHaveCount(1);

    // The clock reads as it was written, and says where that was.
    await expect(row.getByTestId("entry-start")).toHaveValue("09:00");
    await expect(row.getByTestId("entry-end")).toHaveValue("10:00");
    await expect(row.getByTestId("entry-zone")).toHaveText("Tokyo");

    // Opening and saving it unchanged must not move the entry. Before the zone
    // was recorded, this round trip reinterpreted the clock time in the
    // viewer's zone and shifted the entry by the offset between them.
    await row.getByTestId("entry-menu").click();
    await page.getByTestId("entry-menu-edit").click();
    await expect(page.getByTestId("entry-edit-zone-note")).toContainText(
      "Asia/Tokyo",
    );
    await page.getByTestId("entry-edit-save").click();

    await expect(row.getByTestId("entry-start")).toHaveValue("09:00");
    await expect(row.getByTestId("entry-end")).toHaveValue("10:00");
    await expect(row.getByTestId("entry-duration")).toHaveValue("1:00:00");
  });
});
