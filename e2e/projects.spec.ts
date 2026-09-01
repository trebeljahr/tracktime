import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

const PASSWORD = "SecurePassword123!";

const CLIENT_NAME = "Acme Inc.";
const PROJECT_NAME = "Website redesign";
const PROJECT_COLOR = "#14b8a6";
const PROJECT_RATE = "120";
const TASK_NAME = "Homepage hero";

let sequence = 0;

function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

/**
 * Pick an option out of an open-on-click combobox. The trigger carries the
 * caller's test id; the portalled list is keyed by `combobox-option-<id>`,
 * whose ids are only known at runtime, so match on the visible label.
 */
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

/** The id embedded in a `<prefix>-<id>` test id on `row`. */
/**
 * Read the entity id out of a row's `data-testid`.
 *
 * Rows appear first as an optimistic placeholder whose id is a client-side
 * "optimistic-<uuid>", then get replaced when the server responds with the real
 * document. Reading the placeholder id yields locators that stop matching a
 * moment later, so wait for the real id before returning it.
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

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("Projects catalog", () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaUI(page, {
      name: "Catalog User",
      email: uniqueEmail("projects"),
      password: PASSWORD,
    });
    await page.goto("/projects");
    await expect(page.getByTestId("projects-page")).toBeVisible();
  });

  test("creates a client, a project and a task, then tracks against it", async ({
    page,
  }) => {
    // ── client ──────────────────────────────────────────────────────
    await page.getByTestId("tab-clients").click();
    await expect(page.getByTestId("clients-empty")).toBeVisible();

    await page.getByTestId("new-client").click();
    await expect(page.getByTestId("client-dialog")).toBeVisible();
    await page.getByTestId("client-name-input").fill(CLIENT_NAME);
    await page.getByTestId("client-submit").click();

    await expect(page.getByTestId("client-dialog")).toBeHidden();
    const clientRow = page
      .locator('[data-testid^="client-row-"]')
      .filter({ hasText: CLIENT_NAME });
    await expect(clientRow).toHaveCount(1);

    // ── project, attached to that client, coloured and billed ───────
    await page.getByTestId("tab-projects").click();
    await expect(page.getByTestId("projects-empty")).toBeVisible();

    await page.getByTestId("new-project").click();
    await expect(page.getByTestId("project-dialog")).toBeVisible();

    await page.getByTestId("project-name-input").fill(PROJECT_NAME);

    await page.getByTestId("project-color").click();
    await page
      .getByTestId(`project-color-swatch-${PROJECT_COLOR.replace("#", "")}`)
      .click();
    await expect(page.getByTestId("project-color")).toContainText(
      PROJECT_COLOR,
    );

    await pickComboboxOption(page, "project-client-combobox", CLIENT_NAME);
    await expect(page.getByTestId("project-client-combobox")).toContainText(
      CLIENT_NAME,
    );

    await page.getByTestId("project-rate-input").fill(PROJECT_RATE);
    await page.getByTestId("project-submit").click();

    await expect(page.getByTestId("project-dialog")).toBeHidden();

    const projectRow = page
      .locator('[data-testid^="project-row-"]')
      .filter({ hasText: PROJECT_NAME });
    await expect(projectRow).toHaveCount(1);
    // The row carries the client it was attached to and the rate it was given.
    await expect(projectRow).toContainText(CLIENT_NAME);

    const projectId = await idFromTestId(projectRow, "project-row-");
    await expect(page.getByTestId(`project-rate-${projectId}`)).toContainText(
      PROJECT_RATE,
    );
    await expect(page.getByTestId(`project-tracked-${projectId}`)).toHaveText(
      "0:00:00",
    );
    await expect(page.getByTestId(`project-entries-${projectId}`)).toHaveText(
      "0",
    );

    // ── task ────────────────────────────────────────────────────────
    await page.getByTestId(`project-expand-${projectId}`).click();
    await expect(page.getByTestId(`task-panel-${projectId}`)).toBeVisible();
    await expect(page.getByTestId(`tasks-empty-${projectId}`)).toBeVisible();

    await page.getByTestId(`task-new-input-${projectId}`).fill(TASK_NAME);
    await page.getByTestId(`task-add-${projectId}`).click();

    const taskRow = page
      .locator('[data-testid^="task-row-"]')
      .filter({ hasText: TASK_NAME });
    await expect(taskRow).toHaveCount(1);
    await expect(page.getByTestId(`tasks-empty-${projectId}`)).toHaveCount(0);

    const taskId = await idFromTestId(taskRow, "task-row-");
    await expect(page.getByTestId(`task-name-${taskId}`)).toHaveText(TASK_NAME);
    await expect(page.getByTestId(`task-total-${taskId}`)).toHaveText("0:00:00");

    // ── track against the project ───────────────────────────────────
    await page.goto("/track");
    await expect(page.getByTestId("track-page")).toBeVisible();
    await expect(page.getByTestId("entries-empty")).toBeVisible();

    await page.getByTestId("tracker-description").fill("Hero section markup");
    await pickComboboxOption(page, "tracker-project", PROJECT_NAME);
    await expect(page.getByTestId("tracker-project")).toContainText(
      PROJECT_NAME,
    );
    // The project is billable by default, so the bar adopts that.
    await expect(page.getByTestId("tracker-billable")).toHaveAttribute(
      "data-billable",
      "true",
    );

    await page.getByTestId("tracker-toggle").click();
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "running",
    );
    await page.getByTestId("tracker-toggle").click();
    await expect(page.getByTestId("tracker-toggle")).toHaveAttribute(
      "data-state",
      "idle",
    );

    // The chip on the entry names the project it was tracked against.
    const entry = page
      .locator('[data-testid="entry-row"]')
      .filter({ hasText: "Hero section markup" });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByTestId("entry-project")).toContainText(
      PROJECT_NAME,
    );
    await expect(entry.getByTestId("entry-billable")).toHaveAttribute(
      "data-billable",
      "true",
    );

    // …and the catalog now counts that entry against the project.
    await page.goto("/projects");
    await expect(page.getByTestId(`project-entries-${projectId}`)).toHaveText(
      "1",
    );
  });

  test("filters the catalog by search and by client", async ({ page }) => {
    await page.getByTestId("tab-clients").click();
    await page.getByTestId("new-client").click();
    await page.getByTestId("client-name-input").fill(CLIENT_NAME);
    await page.getByTestId("client-submit").click();
    await expect(page.getByTestId("client-dialog")).toBeHidden();

    await page.getByTestId("tab-projects").click();

    for (const name of [PROJECT_NAME, "Internal tooling"]) {
      await page.getByTestId("new-project").click();
      await expect(page.getByTestId("project-dialog")).toBeVisible();
      await page.getByTestId("project-name-input").fill(name);
      if (name === PROJECT_NAME) {
        await pickComboboxOption(page, "project-client-combobox", CLIENT_NAME);
      }
      await page.getByTestId("project-submit").click();
      await expect(page.getByTestId("project-dialog")).toBeHidden();
    }

    const rows = page.locator('[data-testid^="project-row-"]');
    await expect(rows).toHaveCount(2);

    await page.getByTestId("catalog-search").fill("Internal");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Internal tooling");

    await page.getByTestId("catalog-search").fill("");
    await expect(rows).toHaveCount(2);

    await pickComboboxOption(page, "catalog-client-filter", CLIENT_NAME);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(PROJECT_NAME);
  });
});
