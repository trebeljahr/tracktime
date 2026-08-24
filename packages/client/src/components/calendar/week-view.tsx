"use client";

import * as React from "react";
import { addDays, isSameDay, startOfDay } from "date-fns";
import type { DetailedEntry } from "@starter/shared";

import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import { useFormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toDateKey } from "@/components/date-range-picker";
import {
  DRAG_THRESHOLD_PX,
  MINUTES_PER_DAY,
  daySegment,
  expandVisibleRange,
  formatMinuteOfDay,
  isoAtMinute,
  layoutBlocks,
  minutesFromOffset,
  moveRange,
  offsetFromMinutes,
  rangeFromDrag,
  resizeRange,
  type LaidOut,
  type MinuteRange,
  type ResizeEdge,
  type VisibleRange,
} from "./calendar-math";
import { EntryBlock, type BlockDragMode } from "./entry-block";
import { EntryEditPopover } from "./entry-edit-popover";
import { blockPalette } from "./entry-color";
import type { CreateDraft } from "./entry-create-dialog";
import type { CalendarActions } from "./use-calendar-entries";
import { useNow } from "./use-now";

/** 60px per hour keeps the minute→pixel conversion a straight 1:1. */
const PX_PER_MINUTE = 1;

type Segment = MinuteRange & {
  id: string;
  entry: DetailedEntry;
  continuesBefore: boolean;
  continuesAfter: boolean;
  isRunning: boolean;
  /** Running and midnight-spanning segments are read-only. */
  draggable: boolean;
};

type DayColumn = {
  day: Date;
  key: string;
  dayStartMs: number;
  dayEndMs: number;
  blocks: LaidOut<Segment>[];
  totalSec: number;
};

type DragState =
  | {
      kind: "move";
      entryId: string;
      dayIndex: number;
      origin: MinuteRange;
      range: MinuteRange;
      pointerStartY: number;
      active: boolean;
    }
  | {
      kind: "resize";
      entryId: string;
      edge: ResizeEdge;
      dayIndex: number;
      origin: MinuteRange;
      range: MinuteRange;
      pointerStartY: number;
      active: boolean;
    }
  | {
      kind: "create";
      dayIndex: number;
      anchorMin: number;
      range: MinuteRange;
      active: boolean;
    };

export type WeekViewProps = {
  /** Local date of the first day of the week (already week-start aligned). */
  weekStart: Date;
  entries: DetailedEntry[];
  isLoading: boolean;
  actions: CalendarActions;
  /** The user's configured window; widened when entries fall outside it. */
  preferredRange: VisibleRange;
  onRequestCreate: (draft: CreateDraft) => void;
};

/**
 * The week grid: an hour gutter, seven day columns and absolutely positioned
 * entry blocks. All three gestures (move, resize, create) run through one
 * pointer-capture state machine, and every commit goes through the optimistic
 * `actions` so the block never snaps back while the mutation is in flight.
 */
export function WeekView({
  weekStart,
  entries,
  isLoading,
  actions,
  preferredRange,
  onRequestCreate,
}: WeekViewProps): React.JSX.Element {
  const format = useFormatSettings();
  const hasRunning = entries.some((entry) => entry.end === null);
  const nowMs = useNow(hasRunning ? 1_000 : 30_000);

  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const weekStartMs = startOfDay(weekStart).getTime();

  const days = React.useMemo<Date[]>(() => {
    const first = new Date(weekStartMs);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }, [weekStartMs]);

  const columns = React.useMemo<DayColumn[]>(() => {
    return days.map((day) => {
      const dayStartMs = startOfDay(day).getTime();
      const dayEndMs = startOfDay(addDays(day, 1)).getTime();
      const segments: Segment[] = [];
      let totalSec = 0;

      for (const entry of entries) {
        const startMs = Date.parse(entry.start);
        const isRunning = entry.end === null;
        const endMs = isRunning
          ? Math.max(nowMs, startMs)
          : Date.parse(entry.end ?? entry.start);
        const segment = daySegment(startMs, endMs, dayStartMs, dayEndMs);
        if (!segment) continue;

        totalSec += Math.max(0, segment.endMin - segment.startMin) * 60;
        segments.push({
          id: `${entry.id}:${toDateKey(day)}`,
          startMin: segment.startMin,
          endMin: segment.endMin,
          entry,
          continuesBefore: segment.continuesBefore,
          continuesAfter: segment.continuesAfter,
          isRunning,
          draggable:
            !isRunning && !segment.continuesBefore && !segment.continuesAfter,
        });
      }

      return {
        day,
        key: toDateKey(day),
        dayStartMs,
        dayEndMs,
        blocks: layoutBlocks(segments),
        totalSec,
      };
    });
  }, [days, entries, nowMs]);

  const visible = React.useMemo<VisibleRange>(
    () =>
      expandVisibleRange(
        preferredRange,
        columns.flatMap((column) => column.blocks)
      ),
    [columns, preferredRange]
  );
  const { startMin: visibleStart, endMin: visibleEnd } = visible;
  const height = (visibleEnd - visibleStart) * PX_PER_MINUTE;

  const hours = React.useMemo<number[]>(() => {
    const first = Math.ceil(visibleStart / 60);
    const last = Math.floor(visibleEnd / 60);
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) =>
      (first + index) * 60
    );
  }, [visibleEnd, visibleStart]);

  // Auto-scroll to the first entry of the week (minus a little air).
  const weekKey = toDateKey(new Date(weekStartMs));
  const firstEntryMin = React.useMemo<number | null>(() => {
    let earliest: number | null = null;
    for (const column of columns) {
      for (const block of column.blocks) {
        if (earliest === null || block.startMin < earliest) {
          earliest = block.startMin;
        }
      }
    }
    return earliest;
  }, [columns]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const target = firstEntryMin ?? preferredRange.startMin;
    node.scrollTop = Math.max(
      0,
      offsetFromMinutes(target, PX_PER_MINUTE, visible) - 40
    );
    // Only re-aim when the week changes, never on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  // Escape aborts an in-flight drag without committing anything.
  const dragging = drag !== null;
  React.useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dragging]);

  const minuteAtClientY = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return visibleStart;
    return minutesFromOffset(clientY - rect.top, PX_PER_MINUTE, visible);
  };

  const capture = (event: React.PointerEvent<HTMLDivElement>): void => {
    gridRef.current?.setPointerCapture(event.pointerId);
  };

  const handleBlockPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    mode: BlockDragMode,
    block: LaidOut<Segment>,
    dayIndex: number
  ): void => {
    event.stopPropagation();
    if (event.button !== 0 && event.pointerType === "mouse") return;

    if (!block.draggable) {
      setSelectedId(block.entry.id);
      return;
    }

    const origin: MinuteRange = {
      startMin: block.startMin,
      endMin: block.endMin,
    };
    capture(event);
    setDrag(
      mode === "move"
        ? {
            kind: "move",
            entryId: block.entry.id,
            dayIndex,
            origin,
            range: origin,
            pointerStartY: event.clientY,
            active: false,
          }
        : {
            kind: "resize",
            entryId: block.entry.id,
            edge: mode === "resize-start" ? "start" : "end",
            dayIndex,
            origin,
            range: origin,
            pointerStartY: event.clientY,
            active: false,
          }
    );
  };

  const handleColumnPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    dayIndex: number
  ): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    setSelectedId(null);
    const anchorMin = minuteAtClientY(event.clientY);
    capture(event);
    setDrag({
      kind: "create",
      dayIndex,
      anchorMin,
      range: rangeFromDrag(anchorMin, anchorMin),
      active: false,
    });
  };

  const handleGridPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (!drag) return;
    const clientY = event.clientY;
    // Read the geometry once, outside the state updater, which must stay pure.
    const pointerMin = minuteAtClientY(clientY);

    setDrag((current) => {
      if (!current) return current;

      if (current.kind === "create") {
        const active =
          current.active ||
          Math.abs(pointerMin - current.anchorMin) * PX_PER_MINUTE >
            DRAG_THRESHOLD_PX;
        return {
          ...current,
          active,
          range: rangeFromDrag(current.anchorMin, pointerMin),
        };
      }

      const deltaPx = clientY - current.pointerStartY;
      const active = current.active || Math.abs(deltaPx) > DRAG_THRESHOLD_PX;
      if (!active) return current;

      const deltaMinutes = deltaPx / PX_PER_MINUTE;
      const range =
        current.kind === "move"
          ? moveRange(current.origin, deltaMinutes)
          : resizeRange(current.origin, current.edge, deltaMinutes);
      return { ...current, active, range };
    });
  };

  const commitDrag = (state: DragState): void => {
    const day = days[state.dayIndex];
    if (!day) return;

    if (state.kind === "create") {
      if (!state.active) return;
      onRequestCreate({
        start: isoAtMinute(day, state.range.startMin),
        end: isoAtMinute(day, state.range.endMin),
      });
      return;
    }

    if (!state.active) {
      // A press that never moved is a click — open the editor.
      setSelectedId(state.entryId);
      return;
    }

    if (
      state.range.startMin === state.origin.startMin &&
      state.range.endMin === state.origin.endMin
    ) {
      return;
    }

    if (state.kind === "move") {
      actions.update(state.entryId, {
        start: isoAtMinute(day, state.range.startMin),
        end: isoAtMinute(day, state.range.endMin),
      });
      return;
    }

    if (state.edge === "start") {
      actions.update(state.entryId, {
        start: isoAtMinute(day, state.range.startMin),
      });
      return;
    }
    actions.update(state.entryId, {
      end: isoAtMinute(day, state.range.endMin),
    });
  };

  const handleGridPointerUp = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (!drag) return;
    if (gridRef.current?.hasPointerCapture(event.pointerId)) {
      gridRef.current.releasePointerCapture(event.pointerId);
    }
    commitDrag(drag);
    setDrag(null);
  };

  const todayIndex = days.findIndex((day) => isSameDay(day, new Date(nowMs)));
  const nowMinute =
    todayIndex === -1
      ? null
      : (nowMs - startOfDay(new Date(nowMs)).getTime()) / 60_000;

  const gridTemplate = "3.5rem repeat(7, minmax(0, 1fr))";

  return (
    <div
      className="flex min-h-[26rem] flex-col"
      style={{ height: "calc(100dvh - 15rem)" }}
      data-testid="calendar-week"
    >
      {/* Column headers — weekday, date and the day's tracked total. */}
      <div
        className="border-border bg-background grid border-b"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="border-border border-r" />
        {columns.map((column, index) => {
          const isToday = index === todayIndex;
          return (
            <div
              key={column.key}
              data-testid={`calendar-day-header-${column.key}`}
              className={cn(
                "border-border flex flex-col items-center gap-0.5 border-r px-1 py-2 last:border-r-0",
                isToday && "bg-accent/40"
              )}
            >
              <span className="text-muted-foreground text-[0.7rem] tracking-wide uppercase">
                {column.day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  isToday && "text-primary"
                )}
              >
                {column.day.getDate()}
              </span>
              <span
                className="text-muted-foreground text-[0.7rem] tabular-nums"
                data-testid={`calendar-day-total-${column.key}`}
              >
                {column.totalSec > 0 ? format.durationShort(column.totalSec) : "–"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable body. */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div
            ref={gridRef}
            className="relative grid"
            style={{ gridTemplateColumns: gridTemplate, height }}
            onPointerMove={handleGridPointerMove}
            onPointerUp={handleGridPointerUp}
            onPointerCancel={() => {
              setDrag(null);
            }}
          >
            {/* Hour gutter. */}
            <div className="border-border relative border-r">
              {hours.map((minute) => (
                <span
                  key={minute}
                  className="text-muted-foreground absolute right-1 -translate-y-1/2 text-[0.7rem] tabular-nums"
                  style={{
                    top: offsetFromMinutes(minute, PX_PER_MINUTE, visible),
                  }}
                >
                  {formatMinuteOfDay(minute, format.timeFormat)}
                </span>
              ))}
            </div>

            {columns.map((column, dayIndex) => {
              const isToday = dayIndex === todayIndex;
              const createPreview =
                drag?.kind === "create" &&
                drag.dayIndex === dayIndex &&
                drag.active
                  ? drag.range
                  : null;

              return (
                <div
                  key={column.key}
                  data-testid={`calendar-day-column-${column.key}`}
                  className={cn(
                    "border-border relative border-r last:border-r-0",
                    isToday && "bg-accent/20"
                  )}
                  style={{ touchAction: "none" }}
                  onPointerDown={(event) => {
                    handleColumnPointerDown(event, dayIndex);
                  }}
                >
                  {hours.map((minute) => (
                    <div
                      key={minute}
                      aria-hidden
                      className="border-border/70 pointer-events-none absolute inset-x-0 border-t"
                      style={{
                        top: offsetFromMinutes(minute, PX_PER_MINUTE, visible),
                      }}
                    />
                  ))}

                  {column.blocks.map((block) => {
                    const dragged =
                      drag &&
                      drag.kind !== "create" &&
                      drag.active &&
                      drag.entryId === block.entry.id &&
                      drag.dayIndex === dayIndex
                        ? drag.range
                        : null;
                    const range = dragged ?? {
                      startMin: block.startMin,
                      endMin: block.endMin,
                    };
                    const seconds = Math.max(
                      0,
                      (range.endMin - range.startMin) * 60
                    );

                    return (
                      <Popover
                        key={block.id}
                        open={selectedId === block.entry.id}
                        onOpenChange={(open) => {
                          if (!open) setSelectedId(null);
                        }}
                      >
                        <PopoverAnchor asChild>
                          <EntryBlock
                            entry={block.entry}
                            top={offsetFromMinutes(range.startMin, PX_PER_MINUTE, visible)}
                            height={
                              (range.endMin - range.startMin) * PX_PER_MINUTE
                            }
                            leftPct={(block.column / block.columns) * 100}
                            widthPct={100 / block.columns}
                            isRunning={block.isRunning}
                            isDragging={dragged !== null}
                            isSelected={selectedId === block.entry.id}
                            draggable={block.draggable}
                            continuesBefore={block.continuesBefore}
                            continuesAfter={block.continuesAfter}
                            timeLabel={`${formatMinuteOfDay(range.startMin, format.timeFormat)} – ${
                              block.isRunning
                                ? "now"
                                : formatMinuteOfDay(range.endMin, format.timeFormat)
                            }`}
                            durationLabel={format.duration(seconds)}
                            onBlockPointerDown={(event, mode) => {
                              handleBlockPointerDown(
                                event,
                                mode,
                                block,
                                dayIndex
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedId(block.entry.id);
                              }
                            }}
                          />
                        </PopoverAnchor>
                        {selectedId === block.entry.id ? (
                          <EntryEditPopover
                            entry={block.entry}
                            actions={actions}
                            nowMs={nowMs}
                            onClose={() => {
                              setSelectedId(null);
                            }}
                          />
                        ) : null}
                      </Popover>
                    );
                  })}

                  {createPreview ? (
                    <div
                      data-testid="calendar-create-preview"
                      className="border-primary/60 text-primary pointer-events-none absolute inset-x-1 rounded-md border-2 border-dashed px-2 py-1 text-xs tabular-nums"
                      style={{
                        top: offsetFromMinutes(
                          createPreview.startMin,
                          PX_PER_MINUTE,
                          visible
                        ),
                        height:
                          (createPreview.endMin - createPreview.startMin) *
                          PX_PER_MINUTE,
                        background: blockPalette(null).background,
                      }}
                    >
                      {formatMinuteOfDay(createPreview.startMin, format.timeFormat)}
                      {" – "}
                      {formatMinuteOfDay(createPreview.endMin, format.timeFormat)}
                    </div>
                  ) : null}

                  {isToday && nowMinute !== null ? (
                    <div
                      data-testid="calendar-now-line"
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                      style={{
                        top: offsetFromMinutes(
                          Math.min(nowMinute, MINUTES_PER_DAY),
                          PX_PER_MINUTE,
                          visible
                        ),
                      }}
                    >
                      <span className="bg-destructive -ml-1 size-2 rounded-full" />
                      <span className="bg-destructive h-px flex-1" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
