// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NATIVE_SHELL_SCRIPT, THEME_SCRIPT } from "./pre-paint";

/*
 * The pre-paint marker, run for real.
 *
 * The defect this guards is not visual. The marker used to be written to
 * <body>, which made <body>'s attributes disagree with the served HTML at
 * hydration, which forced `suppressHydrationWarning` onto <body> — and that
 * attribute is not scoped to the one mismatch that needed it. It silences
 * every body-level mismatch the web app will ever have, forever, and nothing
 * about that is visible in a browser: React simply stops reporting.
 *
 * Which is also why the coverage is here and not in `e2e/mobile-shell.spec.ts`.
 * `suppressHydrationWarning` is a React-only prop, stripped before the HTML is
 * emitted, so no assertion against the served DOM can see it — an e2e test
 * that looked for the attribute would pass whether or not it was there
 * (measured: it did).
 */

function run(script: string): void {
  new Function(script)();
}

const nativeCapacitor = {
  isNativePlatform: () => true,
  getPlatform: () => "ios",
};

afterEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-platform");
  document.body.className = "";
  document.body.removeAttribute("data-platform");
  Reflect.deleteProperty(window, "Capacitor");
  Reflect.deleteProperty(window, "matchMedia");
});

describe("NATIVE_SHELL_SCRIPT", () => {
  it("marks <html> and leaves <body> alone", () => {
    Object.assign(window, { Capacitor: nativeCapacitor });
    run(NATIVE_SHELL_SCRIPT);

    expect(document.documentElement.classList.contains("cap")).toBe(true);
    expect(document.documentElement.getAttribute("data-platform")).toBe("ios");

    // The half that matters. A write here is what dragged
    // `suppressHydrationWarning` onto <body> in the first place.
    expect(document.body.classList.contains("cap")).toBe(false);
    expect(document.body.getAttribute("data-platform")).toBeNull();
  });

  it("does nothing at all in a browser", () => {
    run(NATIVE_SHELL_SCRIPT);
    expect(document.documentElement.className).toBe("");
    expect(document.documentElement.getAttribute("data-platform")).toBeNull();
  });

  it("does nothing when Capacitor is present but not native", () => {
    // The desktop shells and `ray develop` both load Capacitor-adjacent code
    // in a plain browser context.
    Object.assign(window, {
      Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
    });
    run(NATIVE_SHELL_SCRIPT);
    expect(document.documentElement.className).toBe("");
  });

  it("survives the theme script running after it", () => {
    // Both scripts write <html>'s className now, so their order has to stop
    // mattering. The theme script removes only "light" and "dark".
    Object.assign(window, {
      Capacitor: nativeCapacitor,
      // jsdom ships no matchMedia, and THEME_SCRIPT swallows its own errors —
      // without this the script would silently do nothing and the assertion
      // below would be checking that a no-op is harmless.
      matchMedia: () => ({ matches: true }),
    });
    run(NATIVE_SHELL_SCRIPT);
    run(THEME_SCRIPT);

    expect(document.documentElement.classList.contains("cap")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("app/layout.tsx", () => {
  const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");

  it("does not suppress hydration warnings on <body>", () => {
    // Asserted on the source because there is nowhere else to assert it: the
    // prop never reaches the DOM. If a future change needs it back, it needs
    // an argument in the diff, not a quiet re-add.
    const body = layout.slice(layout.indexOf("<body"), layout.indexOf("</body>"));
    expect(body).not.toContain("suppressHydrationWarning");
  });

  it("keeps the marker in <head>, ahead of the theme script", () => {
    // In <body> it could not mark <html> before <body> existed to be parsed,
    // and the ordering is what makes the layout jump-free on a WebView reload.
    const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
    expect(head).toContain("NATIVE_SHELL_SCRIPT");
    expect(head.indexOf("NATIVE_SHELL_SCRIPT")).toBeLessThan(
      head.indexOf("THEME_SCRIPT"),
    );
  });
});
