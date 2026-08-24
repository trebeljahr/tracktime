"use client";

import * as React from "react";
import { Play } from "lucide-react";
import type { DetailedEntry } from "@starter/shared";

import { cn } from "@/lib/utils";
import { blockPalette } from "./entry-color";

/** How the pointer press that started on this block should be interpreted. */
export type BlockDragMode = "move" | "resize-start" | "resize-end";

export type EntryBlockProps = {
  entry: DetailedEntry;
  /** Pixel geometry inside the day column. */
  top: number;
  height: number;
  /** Percentages, so overlapping blocks share the column width. */
  leftPct: number;
  widthPct: number;
  isRunning: boolean;
  isDragging: boolean;
  isSelected: boolean;
  /** Running and multi-day segments are read-only. */
  draggable: boolean;
  /** The segment is clipped at the top / bottom by midnight. */
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  timeLabel: string;
  durationLabel: string;
  onBlockPointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    mode: BlockDragMode
  ) => void;
} & Omit<React.ComponentPropsWithoutRef<"div">, "onPointerDown" | "children">;

const COMPACT_HEIGHT = 34;
const HANDLE_PX = 7;

/**
 * One entry drawn on the week grid. Purely presentational — every pointer
 * gesture is reported upwards so the grid owns a single drag state machine.
 */
export const EntryBlock = React.forwardRef<HTMLDivElement, EntryBlockProps>(
  function EntryBlock(
    {
      entry,
      top,
      height,
      leftPct,
      widthPct,
      isRunning,
      isDragging,
      isSelected,
      draggable,
      continuesBefore = false,
      continuesAfter = false,
      timeLabel,
      durationLabel,
      onBlockPointerDown,
      className,
      style,
      ...rest
    },
    ref
  ) {
    const palette = blockPalette(entry.projectColor, isDragging || isSelected);
    const compact = height < COMPACT_HEIGHT;

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${entry.description || "No description"}, ${timeLabel}`}
        data-testid={`calendar-entry-${entry.id}`}
        data-running={isRunning ? "true" : undefined}
        className={cn(
          "group absolute overflow-hidden rounded-md border px-2 py-1 text-left text-xs",
          "text-foreground shadow-sm transition-shadow select-none",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          draggable ? "cursor-grab" : "cursor-pointer",
          isDragging && "z-30 cursor-grabbing shadow-lg",
          isSelected && "ring-ring/60 z-20 ring-2",
          continuesBefore && "rounded-t-none border-t-transparent",
          continuesAfter && "rounded-b-none border-b-transparent",
          className
        )}
        style={{
          top,
          height: Math.max(height, 14),
          left: `calc(${leftPct}% + 2px)`,
          width: `calc(${widthPct}% - 4px)`,
          background: palette.background,
          borderColor: palette.border,
          borderLeft: `3px solid ${palette.accent}`,
          touchAction: "none",
          ...style,
        }}
        onPointerDown={(event) => {
          onBlockPointerDown(event, "move");
        }}
        {...rest}
      >
        {draggable ? (
          <>
            <div
              data-testid={`calendar-entry-resize-start-${entry.id}`}
              aria-hidden
              className="absolute inset-x-0 top-0 cursor-ns-resize"
              style={{ height: HANDLE_PX, touchAction: "none" }}
              onPointerDown={(event) => {
                onBlockPointerDown(event, "resize-start");
              }}
            />
            <div
              data-testid={`calendar-entry-resize-end-${entry.id}`}
              aria-hidden
              className="absolute inset-x-0 bottom-0 cursor-ns-resize"
              style={{ height: HANDLE_PX, touchAction: "none" }}
              onPointerDown={(event) => {
                onBlockPointerDown(event, "resize-end");
              }}
            />
          </>
        ) : null}

        <div className="pointer-events-none flex h-full flex-col gap-0.5 overflow-hidden">
          <span className="flex items-center gap-1 truncate font-medium">
            {isRunning ? (
              <Play className="size-3 shrink-0 fill-current" aria-hidden />
            ) : null}
            <span className="truncate">
              {entry.description || "No description"}
            </span>
          </span>
          {compact ? null : (
            <>
              <span className="text-muted-foreground truncate tabular-nums">
                {timeLabel} · {durationLabel}
              </span>
              {entry.projectName ? (
                <span className="text-muted-foreground truncate">
                  {entry.projectName}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }
);
