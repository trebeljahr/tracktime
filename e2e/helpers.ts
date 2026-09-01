import type { Page } from "@playwright/test";

// next.config.ts sets `trailingSlash: true`, so every route resolves to a URL
// ending in "/". A plain string in waitForURL/toHaveURL is an exact match and
// would never match "/track/", so routes are matched by pattern instead.
export const TRACK_URL = /\/track\/?$/;
export const LOGIN_URL = /\/login\/?$/;

export async function signUpViaUI(
  page: Page,
  opts: { name: string; email: string; password: string },
) {
  await page.goto("/signup");
  await page.getByTestId("signup-name").fill(opts.name);
  await page.getByTestId("signup-email").fill(opts.email);
  await page.getByTestId("signup-password").fill(opts.password);
  await page.getByTestId("signup-confirm-password").fill(opts.password);
  await page.getByTestId("signup-submit").click();
  // Wait for navigation to the tracker
  await page.waitForURL(TRACK_URL, { timeout: 10_000 });
}

export async function signInViaUI(
  page: Page,
  opts: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(opts.email);
  await page.getByTestId("login-password").fill(opts.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(TRACK_URL, { timeout: 10_000 });
}

export async function signOutViaUI(page: Page) {
  // Sign out lives inside the user menu in the app shell, so the menu has to
  // be opened before the item exists in the DOM.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();
  await page.waitForURL(LOGIN_URL, { timeout: 10_000 });
}
