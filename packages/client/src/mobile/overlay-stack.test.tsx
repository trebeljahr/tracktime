// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { cleanup, render } from "@testing-library/react";

import {
  dismissTopOverlay,
  overlayCount,
  popOverlay,
  pushOverlay,
  resetOverlayStack,
  useOverlay,
} from "./overlay-stack";

afterEach(() => {
  cleanup();
  resetOverlayStack();
});

describe("the overlay stack", () => {
  it("dismisses the most recently opened overlay first", () => {
    const order: string[] = [];
    pushOverlay(() => order.push("drawer"));
    pushOverlay(() => order.push("dialog"));

    expect(dismissTopOverlay()).toBe(true);
    expect(dismissTopOverlay()).toBe(true);
    expect(order).toEqual(["dialog", "drawer"]);
  });

  it("reports nothing to dismiss when empty", () => {
    // This is the value the back button turns into "exit the app", so an
    // empty stack answering `true` would trap the user inside it.
    expect(dismissTopOverlay()).toBe(false);
  });

  it("removes an overlay from the middle of the stack", () => {
    // Two overlays closing in the same commit unmount in whatever order
    // React chooses, so deregistration cannot assume it is at the top.
    const first = pushOverlay(() => undefined);
    const second = pushOverlay(() => undefined);
    popOverlay(first);

    expect(overlayCount()).toBe(1);
    popOverlay(second);
    expect(overlayCount()).toBe(0);
  });

  it("pops the entry before running its dismiss", () => {
    // A dismiss usually unmounts its overlay, which calls popOverlay again.
    // If the entry were still on the stack that second pop would take
    // whatever had moved into its place.
    const survivor = vi.fn();
    pushOverlay(survivor);
    let seen = -1;
    pushOverlay(() => {
      seen = overlayCount();
    });

    dismissTopOverlay();
    expect(seen).toBe(1);
    expect(survivor).not.toHaveBeenCalled();
  });
});

function Overlay({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}): React.JSX.Element {
  useOverlay(open, onDismiss);
  return <div />;
}

describe("useOverlay", () => {
  it("registers only while open, and deregisters on unmount", () => {
    const dismiss = vi.fn();
    const view = render(<Overlay open={false} onDismiss={dismiss} />);
    expect(overlayCount()).toBe(0);

    view.rerender(<Overlay open onDismiss={dismiss} />);
    expect(overlayCount()).toBe(1);

    view.unmount();
    expect(overlayCount()).toBe(0);
  });

  it("keeps its position when the dismiss identity changes", () => {
    // A caller that passes an inline arrow gets a new function every render.
    // Re-registering on each one would move the overlay to the top of the
    // stack and close things out of order.
    const view = render(<Overlay open onDismiss={() => undefined} />);
    const above = vi.fn();
    pushOverlay(above);

    view.rerender(<Overlay open onDismiss={() => undefined} />);
    dismissTopOverlay();

    expect(above).toHaveBeenCalledTimes(1);
    expect(overlayCount()).toBe(1);
  });

  it("calls the latest dismiss, not the one it registered with", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const view = render(<Overlay open onDismiss={stale} />);
    view.rerender(<Overlay open onDismiss={fresh} />);

    dismissTopOverlay();
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
