// Pure geometry + time math for the calendar. No React, no DOM, no tRPC —
// everything here is deterministic so the drag interactions can be unit
// tested without rendering a grid.

/** Minutes in a nominal calendar day. DST days are clamped to this. */
export const MINUTES_PER_DAY = 1440;

/** Every drag commits on a 5-minute grid. */
export const SNAP_MINUTES = 5;

/** An entry can never be dragged/resized shorter than this. */
export const MIN_DURATION_MINUTES = 5;

/** Pointer travel (px) before a press turns into a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 4;

/** Half-open range of minutes after local midnight. */
export type MinuteRange = {
  startMin: number;
  endMin: number;
};

/** Which handle of a block a resize drag grabbed. */
export type ResizeEdge = "start" | "end";

/** The vertical window of the day the grid renders, in minutes. */
export type VisibleRange = {
  startMin: number;
  endMin: number;
};

/** 6:00 – 22:00, the default window a workday fits into. */
export const DEFAULT_VISIBLE_RANGE: VisibleRange = {
  startMin: 6 * 60,
  endMin: 22 * 60,
};

export const clampMinute = (minute: number): number =>
  Math.min(MINUTES_PER_DAY, Math.max(0, minute));

/** Round to the nearest `step`, never returning a fractional minute. */
export const snapMinutes = (value: number, step: number = SNAP_MINUTES): number =>
  Math.round(value / step) * step;

/** Minute-of-day for a pixel offset measured from the top of the grid. */
export const minutesFromOffset = (
  offsetY: number,
  pxPerMinute: number,
  range: VisibleRange = DEFAULT_VISIBLE_RANGE
): number => {
  if (pxPerMinute <= 0) return range.startMin;
  return range.startMin + offsetY / pxPerMinute;
};

/** Pixel offset from the top of the grid for a minute-of-day. */
export const offsetFromMinutes = (
  minute: number,
  pxPerMinute: number,
  range: VisibleRange = DEFAULT_VISIBLE_RANGE
): number => (minute - range.startMin) * pxPerMinute;

/** Total pixel height of a grid rendering `range` at `pxPerMinute`. */
export const gridHeight = (range: VisibleRange, pxPerMinute: number): number =>
  Math.max(0, (range.endMin - range.startMin) * pxPerMinute);

/**
 * Move a block by `deltaMinutes`, keeping its duration and snapping the new
 * start. The block is kept inside the day rather than clipped.
 */
export const moveRange = (
  range: MinuteRange,
  deltaMinutes: number,
  step: number = SNAP_MINUTES
): MinuteRange => {
  const duration = Math.max(MIN_DURATION_MINUTES, range.endMin - range.startMin);
  const snapped = snapMinutes(range.startMin + deltaMinutes, step);
  const startMin = Math.min(
    MINUTES_PER_DAY - duration,
    Math.max(0, snapped)
  );
  return { startMin, endMin: startMin + duration };
};

/**
 * Drag one edge of a block. The opposite edge is fixed and the block keeps
 * at least `minDuration` minutes, so the edges can never cross.
 */
export const resizeRange = (
  range: MinuteRange,
  edge: ResizeEdge,
  deltaMinutes: number,
  step: number = SNAP_MINUTES,
  minDuration: number = MIN_DURATION_MINUTES
): MinuteRange => {
  if (edge === "start") {
    const snapped = snapMinutes(range.startMin + deltaMinutes, step);
    const startMin = Math.min(
      range.endMin - minDuration,
      Math.max(0, snapped)
    );
    return { startMin, endMin: range.endMin };
  }
  const snapped = snapMinutes(range.endMin + deltaMinutes, step);
  const endMin = Math.max(
    range.startMin + minDuration,
    Math.min(MINUTES_PER_DAY, snapped)
  );
  return { startMin: range.startMin, endMin };
};

/**
 * The range produced by dragging on empty space from `anchorMin` to
 * `pointerMin`. Works in both directions and always yields a usable block.
 */
export const rangeFromDrag = (
  anchorMin: number,
  pointerMin: number,
  step: number = SNAP_MINUTES,
  minDuration: number = MIN_DURATION_MINUTES
): MinuteRange => {
  const anchor = clampMinute(snapMinutes(anchorMin, step));
  const pointer = clampMinute(snapMinutes(pointerMin, step));
  let startMin = Math.min(anchor, pointer);
  let endMin = Math.max(anchor, pointer);

  if (endMin - startMin < minDuration) {
    endMin = startMin + minDuration;
    if (endMin > MINUTES_PER_DAY) {
      endMin = MINUTES_PER_DAY;
      startMin = endMin - minDuration;
    }
  }
  return { startMin, endMin };
};

// ── day segmentation ─────────────────────────────────────────────────

/** The part of an entry that falls inside one calendar day. */
export type DaySegment = MinuteRange & {
  /** The entry started before this day (drawn flush to the top). */
  continuesBefore: boolean;
  /** The entry ends after this day (drawn flush to the bottom). */
  continuesAfter: boolean;
};

/**
 * Clip an absolute [startMs, endMs) interval to one calendar day, expressed
 * in minutes after that day's local midnight. Returns null when the entry
 * does not touch the day at all.
 *
 * `dayEndMs` is passed rather than derived so DST days (23h/25h) still land
 * on the right boundary; the resulting minutes are clamped to a nominal day.
 */
export const daySegment = (
  startMs: number,
  endMs: number,
  dayStartMs: number,
  dayEndMs: number
): DaySegment | null => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  const safeEnd = Math.max(endMs, startMs);
  const startsInDay = startMs >= dayStartMs && startMs < dayEndMs;
  const overlaps = startMs < dayEndMs && safeEnd > dayStartMs;
  if (!startsInDay && !overlaps) return null;

  const from = Math.max(startMs, dayStartMs);
  const to = Math.min(safeEnd, dayEndMs);

  const startMin = clampMinute((from - dayStartMs) / 60_000);
  const endMin = clampMinute((to - dayStartMs) / 60_000);

  return {
    startMin,
    endMin: Math.max(endMin, startMin),
    continuesBefore: startMs < dayStartMs,
    continuesAfter: safeEnd > dayEndMs,
  };
};

// ── overlap layout ───────────────────────────────────────────────────

/** Anything that can be laid out — an id plus the minutes it occupies. */
export type LayoutInput = MinuteRange & { id: string };

export type LaidOut<T extends LayoutInput> = T & {
  /** 0-based column inside its overlap cluster. */
  column: number;
  /** How many columns the cluster needs. */
  columns: number;
};

/**
 * Side-by-side layout for overlapping blocks.
 *
 * Blocks are swept in start order into clusters of mutually overlapping
 * entries; inside a cluster each block takes the first column whose previous
 * block has already ended. Every block of a cluster reports the cluster's
 * column count so their widths line up.
 */
export const layoutBlocks = <T extends LayoutInput>(
  blocks: readonly T[]
): LaidOut<T>[] => {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.endMin - b.startMin - (a.endMin - a.startMin) ||
      a.id.localeCompare(b.id)
  );

  const out: LaidOut<T>[] = [];
  let cluster: LaidOut<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    const columns = Math.max(1, columnEnds.length);
    for (const block of cluster) out.push({ ...block, columns });
    cluster = [];
    columnEnds = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const block of sorted) {
    // A zero-length block still occupies a sliver of time visually.
    const end = Math.max(block.endMin, block.startMin + 1);
    if (cluster.length > 0 && block.startMin >= clusterEnd) flush();

    let column = columnEnds.findIndex((columnEnd) => block.startMin >= columnEnd);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    cluster.push({ ...block, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();

  return out;
};

// ── formatting + conversion ──────────────────────────────────────────

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** "09:30" or "9:30 AM" for a minute-of-day. */
export const formatMinuteOfDay = (
  minute: number,
  timeFormat: "12h" | "24h" = "24h"
): string => {
  const total = Math.round(clampMinute(minute));
  const hours24 = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  if (timeFormat === "24h") return `${pad2(hours24)}:${pad2(minutes)}`;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad2(minutes)} ${suffix}`;
};

/** ISO timestamp for `minute` minutes after the local midnight of `day`. */
export const isoAtMinute = (day: Date, minute: number): string => {
  const date = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0
  );
  date.setMinutes(date.getMinutes() + Math.round(minute));
  return date.toISOString();
};

/**
 * Widen `preferred` so every one of `segments` is reachable, then round out
 * to whole hours. Entries outside the configured window must still render.
 */
export const expandVisibleRange = (
  preferred: VisibleRange,
  segments: readonly MinuteRange[]
): VisibleRange => {
  let startMin = preferred.startMin;
  let endMin = preferred.endMin;

  for (const segment of segments) {
    if (segment.startMin < startMin) startMin = segment.startMin;
    if (segment.endMin > endMin) endMin = segment.endMin;
  }

  startMin = Math.max(0, Math.floor(startMin / 60) * 60);
  endMin = Math.min(MINUTES_PER_DAY, Math.ceil(endMin / 60) * 60);
  if (endMin - startMin < 60) endMin = Math.min(MINUTES_PER_DAY, startMin + 60);
  return { startMin, endMin };
};
