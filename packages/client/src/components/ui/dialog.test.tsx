// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  dismissTopOverlay,
  overlayCount,
  resetOverlayStack,
} from "@/mobile/overlay-stack";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/*
 * Every dialog in the app registers on the overlay stack the moment it opens,
 * so Android's hardware back button closes it instead of navigating away
 * underneath it. That happens once, here in the primitive, rather than in
 * each of the app's eleven dialogs — so a twelfth cannot forget.
 */

afterEach(() => {
  cleanup();
  resetOverlayStack();
});

const Fixture = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange?: (next: boolean) => void;
}): React.JSX.Element => (
  <Dialog open={open} {...(onOpenChange ? { onOpenChange } : {})}>
    <DialogContent>
      <DialogTitle>Edit entry</DialogTitle>
    </DialogContent>
  </Dialog>
);

describe("Dialog", () => {
  it("is on the overlay stack only while it is open", () => {
    const view = render(<Fixture open={false} onOpenChange={() => undefined} />);
    expect(overlayCount()).toBe(0);

    view.rerender(<Fixture open onOpenChange={() => undefined} />);
    expect(overlayCount()).toBe(1);

    view.rerender(<Fixture open={false} onOpenChange={() => undefined} />);
    expect(overlayCount()).toBe(0);
  });

  it("closes itself when the stack dismisses it", () => {
    const onOpenChange = vi.fn();
    render(<Fixture open onOpenChange={onOpenChange} />);

    expect(dismissTopOverlay()).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not register when there is no way to close it", () => {
    // An uncontrolled dialog keeps its open state inside Radix. Registering
    // it would put an entry on the stack that back could pop but not close,
    // which is worse than not registering: the press is swallowed and
    // nothing happens.
    render(<Fixture open />);
    expect(overlayCount()).toBe(0);
  });
});
