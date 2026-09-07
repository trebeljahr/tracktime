// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleBackPress, ROOT_TAB } from "./back-button";
import { pushOverlay, resetOverlayStack } from "./overlay-stack";

afterEach(resetOverlayStack);

describe("handleBackPress", () => {
  it("closes the top overlay and consumes the press", () => {
    const dismiss = vi.fn();
    pushOverlay(dismiss);
    const navigate = vi.fn();

    expect(handleBackPress({ pathname: "/settings", navigate })).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1);
    // An open dialog absorbs the press entirely — it must not also navigate.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns to the root tab from anywhere else", () => {
    const navigate = vi.fn();
    expect(
      handleBackPress({
        pathname: "/reports/detailed",
        navigate,
        dismissOverlay: () => false,
      }),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith(ROOT_TAB);
  });

  it("asks to exit at the root tab", () => {
    const navigate = vi.fn();
    expect(
      handleBackPress({
        pathname: ROOT_TAB,
        navigate,
        dismissOverlay: () => false,
      }),
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("treats a child of the root tab as the root", () => {
    // Nothing lives under /track today, but a future detail route must not
    // navigate to its own parent and then need a second press to exit.
    expect(
      handleBackPress({
        pathname: "/track/2026-09-07",
        navigate: () => undefined,
        dismissOverlay: () => false,
      }),
    ).toBe(false);
  });
});
