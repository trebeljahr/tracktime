"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { readSafeAreaInsets, withSafeArea } from "@/lib/safe-area";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, collisionPadding, ...props }, ref) => {
  /*
   * Every popover in the app comes through here, so the safe area is handled
   * once. Floating UI places the panel against the LAYOUT viewport, and under
   * `viewport-fit=cover` that viewport begins at the physical top of the
   * screen — so a popover with nowhere to go is shifted to `collisionPadding`
   * from the top edge and lands under the Dynamic Island. Widening the padding
   * by the insets is the only lever Radix gives; see lib/safe-area.ts for why
   * `collisionBoundary` is not the other one.
   *
   * Computed per mount rather than per render: Radix unmounts the content when
   * the popover closes, so a fresh mount is a fresh read, and the calendar's
   * editor re-renders every second while a timer runs. The insets themselves
   * are fixed for the life of a mount — the phone is portrait-locked
   * (capacitor.config.ts), so there is no rotation to listen for.
   *
   * On web `withSafeArea` returns what it was handed, unchanged and
   * identical — including `undefined`, so Radix keeps its own default.
   */
  const padding = React.useMemo(
    // The read is passed in rather than defaulted inside `withSafeArea`, so
    // the two halves stay separately replaceable: popover.test.tsx swaps the
    // reader and exercises the real widening.
    () => withSafeArea(collisionPadding, readSafeAreaInsets()),
    [collisionPadding],
  );

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={padding}
        // styles/native.css bounds this to the safe area on the phone, the
        // way it does `[data-slot="dialog-content"]`. Radix puts no stable
        // class or attribute on the panel itself.
        data-slot="popover-content"
        className={cn(
          "z-50 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
