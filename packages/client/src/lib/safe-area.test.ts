// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  readSafeAreaInsets,
  withSafeArea,
  type PropertyReader,
} from "./safe-area";

/*
 * The numbers that decide where a popover is allowed to land on a notched
 * phone. The defect these guard: `viewport-fit=cover` makes the layout
 * viewport start at the physical top of the screen, so a Radix popover with
 * nowhere to go is shifted to `collisionPadding` from that edge — under the
 * Dynamic Island — and no CSS can move it back.
 *
 * The reader is injected rather than driven through a stylesheet: jsdom does
 * not resolve `env()` and does not carry custom properties into
 * `getComputedStyle`, so a test that set `--app-safe-area-top` on <html> would
 * assert nothing. The real read is checked in `e2e/mobile-shell.spec.ts`,
 * which measures the properties in a browser.
 */

const reader = (values: Record<string, string>): PropertyReader =>
  (name) => values[name] ?? "";

describe("readSafeAreaInsets", () => {
  it("reads the four properties native.css publishes", () => {
    expect(
      readSafeAreaInsets(
        reader({
          "--app-safe-area-top": "59px",
          "--app-safe-area-right": "0px",
          "--app-safe-area-bottom": "34px",
          "--app-safe-area-left": "0px",
        }),
      ),
    ).toEqual({ top: 59, right: 0, bottom: 34, left: 0 });
  });

  it("is all zeroes when nothing defines them — every browser", () => {
    expect(readSafeAreaInsets(reader({}))).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("answers zero for a value that did not resolve", () => {
    // If some engine ever handed back the literal token instead of
    // substituting it, the popover has to degrade to its unfixed behaviour —
    // never to a panel positioned by NaN.
    expect(
      readSafeAreaInsets(
        reader({ "--app-safe-area-top": "env(safe-area-inset-top, 0px)" }),
      ).top,
    ).toBe(0);
  });

  it("reads the real document without throwing, and finds nothing there", () => {
    // The default reader path, exercised so a typo in it cannot hide behind
    // the injected one. jsdom is not a notched phone.
    expect(readSafeAreaInsets()).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});

describe("withSafeArea", () => {
  const insets = { top: 59, right: 0, bottom: 34, left: 0 };

  it("widens a number on every side", () => {
    expect(withSafeArea(8, insets)).toEqual({
      top: 67,
      right: 8,
      bottom: 42,
      left: 8,
    });
  });

  it("widens a per-side object, and fills the sides it omits", () => {
    expect(withSafeArea({ top: 8 }, insets)).toEqual({
      top: 67,
      right: 0,
      bottom: 34,
      left: 0,
    });
  });

  it("widens Radix's own default when the caller passed nothing", () => {
    // `undefined` means "Radix's default of 0" — which on a phone is 0 from
    // the top of the screen, i.e. squarely under the notch.
    expect(withSafeArea(undefined, insets)).toEqual({
      top: 59,
      right: 0,
      bottom: 34,
      left: 0,
    });
  });

  it("returns the caller's own value, identically, when there are no insets", () => {
    // The web non-regression, asserted on identity rather than equality: on
    // every browser this function must not turn `8` into an object or
    // `undefined` into `{0,0,0,0}`, or Radix's defaults stop being Radix's.
    const object = { top: 8 };
    expect(withSafeArea(8)).toBe(8);
    expect(withSafeArea(undefined)).toBeUndefined();
    expect(withSafeArea(object)).toBe(object);
  });
});
