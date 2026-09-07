import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";
import { cleanDatabase, closeDbConnection } from "./db-utils";

/**
 * The web app at phone width.
 *
 * This runs in the `phone` Playwright project (playwright.config.ts) — a
 * 393pt chromium viewport against the same servers every other spec uses.
 * It is NOT a test of the native app, which no browser can run. It is the
 * guard on the claim that makes the native work safe: every rule in
 * packages/client/src/styles/native.css is scoped under `body.cap`, a class
 * only the Capacitor shell ever sets, so a narrow browser window is
 * untouched by all of it.
 *
 * That claim is easy to break by accident — one rule written as
 * `@media (max-width: 640px)` instead of `body.cap`, and the web app silently
 * inherits the phone treatment. So the assertions below are deliberately
 * about the ABSENCE of native chrome, not the presence of it.
 */

const PASSWORD = "SecurePassword123!";

let sequence = 0;
function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

test.beforeAll(async () => {
  await cleanDatabase();
});

test.afterAll(async () => {
  await closeDbConnection();
});

test.describe("web app at phone width", () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaUI(page, {
      name: "Phone Layout",
      email: uniqueEmail("phone"),
      password: PASSWORD,
    });
  });

  test("is not treated as the native shell", async ({ page }) => {
    // The premise. Everything else in this file follows from it.
    await expect(page.locator("body")).not.toHaveClass(/\bcap\b/);
    expect(await page.locator("body").getAttribute("data-platform")).toBeNull();
  });

  test("gets the drawer, not native chrome", async ({ page }) => {
    // The web app's own narrow-screen affordance is the hamburger + drawer,
    // and it still is one: the native tab bar arrives in stage 3 behind the
    // same `body.cap` gate.
    const toggle = page.getByTestId("sidebar-toggle");
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.getByTestId("sidebar-mobile")).toBeVisible();
    await page.getByTestId("sidebar-close").click();
    await expect(page.getByTestId("sidebar-mobile")).toHaveCount(0);
  });

  test("keeps the web input size — no 16px override", async ({ page }) => {
    // native.css forces 16px on native fields so iOS does not zoom on focus.
    // On web the design's own `text-sm` has to survive.
    const size = await page
      .getByTestId("tracker-description")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).not.toBe("16px");
  });

  test("keeps the web header height — no safe-area padding", async ({
    page,
  }) => {
    const header = page.getByTestId("app-header");
    await expect(header).toBeVisible();

    const box = await header.evaluate((el) => {
      const style = getComputedStyle(el);
      return { height: style.height, paddingTop: style.paddingTop };
    });
    // `h-14` and nothing added on top of it.
    expect(box.height).toBe("56px");
    expect(box.paddingTop).toBe("0px");
  });

  test("keeps the web tracker composer on one wrapping row", async ({
    page,
  }) => {
    // native.css gives the description the whole first line under `body.cap`.
    // On web it shares the row, so its width is well under the composer's.
    const composer = page.getByTestId("tracker-composer");
    const description = page.getByTestId("tracker-description");
    await expect(composer).toBeVisible();

    const composerWidth = (await composer.boundingBox())?.width ?? 0;
    const descriptionWidth = (await description.boundingBox())?.width ?? 0;
    expect(composerWidth).toBeGreaterThan(0);
    expect(descriptionWidth).toBeLessThan(composerWidth);
  });

  test("keeps dialogs centred — no top anchoring", async ({ page }) => {
    await page.getByTestId("tracker-manual-open").click();

    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();
    // `top-[50%]` untouched: native.css moves it to the safe-area inset only
    // under `body.cap`.
    expect(await dialog.evaluate((el) => getComputedStyle(el).top)).toBe("50%");
  });

  test("the entries list still starts where the web layout puts it", async ({
    page,
  }) => {
    // STICKY_TOP in entry-list.tsx now reads `var(--app-header-offset, 3.5rem)`.
    // The variable is set only by native.css, so on web it must be unset and
    // the fallback must be what applies.
    const offset = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--app-header-offset").trim(),
    );
    expect(offset).toBe("");
  });
});
