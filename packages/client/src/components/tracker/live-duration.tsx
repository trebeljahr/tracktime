"use client";

import * as React from "react";
import { toLocalDateKey } from "@starter/shared";

import { useRunningEntry } from "@/hooks/use-sync";
import { useFormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LiveDurationProps = {
  /** Seconds already accounted for by finished entries. */
  baseSec: number;
  /** Add the live elapsed seconds when the running entry has this id. */
  matchEntryId?: string;
  /** …or when the running entry started on this local calendar day. */
  matchDate?: string;
  className?: string;
  testId?: string;
};

/**
 * A duration that ticks, isolated into its own component on purpose.
 *
 * The tracker's day headers and its one running row are the only things that
 * change every second; subscribing to the clock here keeps the hundreds of
 * finished rows above them out of the per-second render.
 */
export function LiveDuration({
  baseSec,
  matchEntryId,
  matchDate,
  className,
  testId,
}: LiveDurationProps): React.JSX.Element {
  const { entry, elapsedSec } = useRunningEntry();
  const format = useFormatSettings();

  const matches =
    entry !== null &&
    ((matchEntryId !== undefined && entry.id === matchEntryId) ||
      (matchDate !== undefined &&
        toLocalDateKey(new Date(entry.start)) === matchDate));

  return (
    <span
      className={cn("font-mono tabular-nums", className)}
      data-testid={testId}
    >
      {format.duration(baseSec + (matches ? elapsedSec : 0))}
    </span>
  );
}
