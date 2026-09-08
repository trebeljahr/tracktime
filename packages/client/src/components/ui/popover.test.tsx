// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

/*
 * The wiring between lib/safe-area.ts and Radix. What is under test is the
 * ONE prop that decides whether a popover can be shifted under the Dynamic
 * Island — `collisionPadding` — plus the `data-slot` hook styles/native.css
 * needs to bound the panel's size.
 *
 * Radix is mocked, deliberately. Floating UI measures a real layout; jsdom has
 * none, so a rendered Radix popover would report zeroes for every rect and the
 * assertion would be about nothing. Recording the props Radix is handed is the
 * honest unit boundary here — where the panel then LANDS is a browser
 * question, and `e2e/mobile-shell.spec.ts` asks it there.
 */

const { contentProps } = vi.hoisted(() => ({
  contentProps: [] as Record<string, unknown>[],
}));

vi.mock("@radix-ui/react-popover", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  const pass =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      react.createElement(tag, null, children);
  return {
    Root: pass("div"),
    Trigger: pass("button"),
    Anchor: pass("div"),
    Close: pass("button"),
    Portal: pass("div"),
    Content: (props: Record<string, unknown>) => {
      contentProps.push(props);
      return react.createElement("div", {
        "data-slot": props["data-slot"],
      });
    },
  };
});

beforeEach(() => {
  contentProps.length = 0;
});
afterEach(cleanup);

async function renderContent(
  props: Record<string, unknown> = {},
): Promise<void> {
  const { Popover, PopoverContent } = await import("./popover");
  render(
    <Popover>
      <PopoverContent {...props}>body</PopoverContent>
    </Popover>,
  );
}

describe("PopoverContent", () => {
  it("carries the data-slot native.css bounds the panel with", async () => {
    await renderContent();
    expect(contentProps[0]?.["data-slot"]).toBe("popover-content");
  });

  it("leaves collisionPadding exactly as the caller gave it on web", async () => {
    // No insets are published in a browser, so every popover in the app has
    // to behave precisely as it did before this file existed — including
    // keeping Radix's own default when nothing was passed.
    await renderContent();
    expect(contentProps[0]?.collisionPadding).toBeUndefined();

    contentProps.length = 0;
    await renderContent({ collisionPadding: 8 });
    expect(contentProps[0]?.collisionPadding).toBe(8);
  });
});

describe("PopoverContent on a notched phone", () => {
  it("widens the caller's collision padding by the insets", async () => {
    vi.resetModules();
    vi.doMock("@/lib/safe-area", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/safe-area")>(
          "@/lib/safe-area",
        );
      return {
        ...actual,
        readSafeAreaInsets: () => ({
          top: 59,
          right: 0,
          bottom: 34,
          left: 0,
        }),
      };
    });

    try {
      // The calendar's entry editor passes 8. Without the widening it can be
      // shifted to 8px from the top of the LAYOUT viewport, which under
      // `viewport-fit=cover` is 8px from the physical top of the screen.
      await renderContent({ collisionPadding: 8 });
      expect(contentProps[0]?.collisionPadding).toEqual({
        top: 67,
        right: 8,
        bottom: 42,
        left: 8,
      });
    } finally {
      vi.doUnmock("@/lib/safe-area");
      vi.resetModules();
    }
  });
});
