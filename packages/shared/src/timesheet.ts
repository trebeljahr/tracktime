/**
 * The weekly timesheet grid: rows of project/task, columns of weekday, cells
 * holding hours.
 *
 * ── Why a cell edit needs rules ──────────────────────────────────────
 *
 * A cell is not a record. It is the SUM of however many entries fall on that
 * day for that project+task, and a sum cannot be written back to without
 * deciding which of its terms to change. Typing "3h" into a cell that already
 * holds two entries of 1h and 2h has no single correct meaning, and the naive
 * implementations of this feature all pick one silently — usually "rewrite the
 * most recent entry" — which quietly destroys a record the user never pointed
 * at.
 *
 * So the resolution is explicit, and `planCellEdit` is the only place it is
 * decided. It returns a PLAN rather than performing anything, which is what
 * lets the same rules be unit-tested without a database or a browser, and
 * lets the UI render the cell honestly *before* the user types: a cell whose
 * edit would be refused is shown read-only with its breakdown, instead of
 * accepting a keystroke and then throwing it away.
 *
 * The rules, in order:
 *
 *  1. A cell containing the RUNNING entry is never writable. The timer owns
 *     that entry's end; a grid edit would race it and lose time.
 *  2. Zero entries → create exactly one. See `cellStartMs` for the clock time
 *     convention and why it is not midnight.
 *  3. Exactly one entry, lying entirely inside the day → move its END. The
 *     start is a fact the user recorded ("I started at nine"); the end is the
 *     part an after-the-fact estimate revises. Typing 0 deletes it, which is
 *     the exact inverse of rule 2 rather than a second, hidden convention.
 *  4. Exactly one entry that crosses midnight → refused. Moving its end would
 *     silently change a DIFFERENT day's cell too, so it is edited where its
 *     whole shape is visible: the tracker list or the calendar.
 *  5. More than one entry → refused, with a breakdown and a link through. Any
 *     automatic choice here is the data-corrupting one.
 *
 * ── Day bucketing ────────────────────────────────────────────────────
 *
 * Days are bucketed in an explicit zone, which callers pass as the BROWSER's
 * zone so the grid agrees with the tracker list (see `splitIntervalByZonedDay`
 * in timezone.ts). An entry crossing midnight is split across the days it
 * touches, so its slices re-sum to exactly its own duration and the week total
 * is real elapsed time — never a double count.
 */

import { formatDuration, parseDurationInput } from "./duration.js";
import {
  addDaysToKey,
  splitIntervalByZonedDay,
  zonedDayStartMs,
  zonedWallClockToMs,
  type DayKey,
} from "./timezone.js";
import type { DurationFormat } from "./types.js";

const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

/** Days in a timesheet week. */
export const TIMESHEET_DAYS = 7;

/**
 * Wall-clock hour a cell-created entry starts at.
 *
 * A cell records "three hours on Thursday" — there is no real clock time in
 * that statement, but every other screen renders one, so the convention has to
 * be defensible rather than arbitrary. 09:00 is the start of a conventional
 * working day, which is what the calendar and the tracker list will show, and
 * it is a wall-clock time that exists in every zone on every date. Midnight is
 * not: zones that shift DST at 00:00 (America/Santiago, for one) skip it
 * entirely on one day a year, and an entry anchored there would land an hour
 * off the day it was typed into.
 */
export const TIMESHEET_START_HOUR = 9;

/** A single day cannot hold more time than the day itself has. */
export const TIMESHEET_MAX_CELL_SECONDS = 24 * SECONDS_PER_HOUR;

// ── input parsing ────────────────────────────────────────────────────

/**
 * Parse what a person types into a timesheet cell.
 *
 * A bare number means HOURS here — "1.5" is ninety minutes — because a
 * timesheet cell is filled in hours and everybody who has used one types "8".
 * That is deliberately the opposite of `parseDurationInput`, where a bare
 * number means minutes because the tracker's duration field is filled from a
 * running clock. Every explicit spelling means the same thing in both: "1:30",
 * "90m" and "1h30m" are all ninety minutes.
 *
 * An empty cell is 0, not a parse failure — clearing a cell is how time is
 * removed. Returns null when the input is not a duration at all.
 */
export const parseTimesheetCell = (raw: string): number | null => {
  const input = raw.trim().toLowerCase();
  if (input === "") return 0;

  // A bare decimal ("8", "1.5", "1,5", ".5") — hours.
  if (/^\d*[.,]?\d*$/.test(input) && /\d/.test(input)) {
    const hours = Number(input.replace(",", "."));
    if (!Number.isFinite(hours)) return null;
    return Math.round(hours * SECONDS_PER_HOUR);
  }

  // Everything else is spelled out, and means what it means everywhere else.
  return parseDurationInput(input);
};

/**
 * What a cell shows. Zero renders as an empty cell rather than "0:00:00" — a
 * grid of zeroes is unreadable, and an empty cell is what "nothing tracked"
 * looks like on paper.
 */
export const formatTimesheetCell = (
  seconds: number,
  format: DurationFormat = "hms"
): string => (seconds <= 0 ? "" : formatDuration(seconds, format));

// ── grid shape ───────────────────────────────────────────────────────

/** The subset of an entry the grid needs. */
export type TimesheetEntryInput = {
  id: string;
  projectId: string | null;
  taskId: string | null;
  /** ISO datetime. */
  start: string;
  /** ISO datetime, or null while running. */
  end: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  taskName?: string | null;
};

/** One entry's contribution to one cell. */
export type TimesheetCellEntry = {
  id: string;
  start: string;
  end: string | null;
  /** Seconds this entry contributes to THIS cell's day, never its whole span. */
  secondsInCell: number;
  /** False when the entry crosses midnight, so this cell holds only a slice. */
  containedInDay: boolean;
  running: boolean;
};

export type TimesheetCell = {
  /** "YYYY-MM-DD" in the grid's zone. */
  day: DayKey;
  seconds: number;
  entries: TimesheetCellEntry[];
};

export type TimesheetRow = {
  projectId: string | null;
  taskId: string | null;
  label: string;
  color: string | null;
  /** True when the row was pinned by the user rather than implied by entries. */
  pinned: boolean;
  /** Seven cells, aligned with `days`. */
  cells: TimesheetCell[];
  totalSec: number;
};

export type TimesheetGrid = {
  days: DayKey[];
  rows: TimesheetRow[];
  dayTotals: number[];
  totalSec: number;
};

/** A row the user pinned, which shows even in a week with no time on it. */
export type TimesheetRowSeed = {
  projectId: string | null;
  taskId: string | null;
  label?: string | null;
  color?: string | null;
};

/** Label for a row with no project. Matches the reports' wording. */
export const NO_PROJECT_LABEL = "No project";

/**
 * Stable identity for a project+task row. Same shape the weekly report uses,
 * so a row means the same thing on both screens.
 */
export const timesheetRowKey = (
  projectId: string | null,
  taskId: string | null
): string => `${projectId ?? ""}::${taskId ?? ""}`;

const rowLabel = (
  projectName: string | null | undefined,
  taskName: string | null | undefined
): string => {
  const project = projectName ?? NO_PROJECT_LABEL;
  return taskName ? `${project} – ${taskName}` : project;
};

/** "No project" sorts last; everything else alphabetically, case-insensitively. */
const byLabel = (a: TimesheetRow, b: TimesheetRow): number => {
  const aNone = a.projectId === null;
  const bNone = b.projectId === null;
  if (aNone !== bNone) return aNone ? 1 : -1;
  return a.label.localeCompare(b.label);
};

const emptyRow = (
  seed: TimesheetRowSeed,
  days: DayKey[],
  pinned: boolean
): TimesheetRow => ({
  projectId: seed.projectId,
  taskId: seed.taskId,
  label: seed.label ?? rowLabel(null, null),
  color: seed.color ?? null,
  pinned,
  cells: days.map((day) => ({ day, seconds: 0, entries: [] })),
  totalSec: 0,
});

/**
 * Aggregate a week's entries into the grid.
 *
 * The cell totals and the entries an edit resolves against come out of this
 * one pass on purpose. Computing the totals server-side and the edit targets
 * client-side is how a grid ends up showing 3h in a cell whose edit path is
 * looking at a different set of entries.
 */
export const buildTimesheetGrid = (args: {
  entries: readonly TimesheetEntryInput[];
  days: readonly DayKey[];
  timeZone: string;
  /** Running entries are measured to here. */
  nowMs: number;
  /** Rows to show even when the week has no time on them. */
  seeds?: readonly TimesheetRowSeed[];
}): TimesheetGrid => {
  const days = [...args.days];
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const rows = new Map<string, TimesheetRow>();

  for (const seed of args.seeds ?? []) {
    const key = timesheetRowKey(seed.projectId, seed.taskId);
    if (rows.has(key)) continue;
    rows.set(key, {
      ...emptyRow(seed, days, true),
      label: seed.label ?? rowLabel(null, null),
    });
  }

  for (const entry of args.entries) {
    const startMs = Date.parse(entry.start);
    if (Number.isNaN(startMs)) continue;

    const running = entry.end === null;
    const endMs = running ? Math.max(args.nowMs, startMs) : Date.parse(entry.end ?? "");
    if (Number.isNaN(endMs)) continue;

    const slices = splitIntervalByZonedDay(startMs, endMs, args.timeZone);
    // A stopped entry of zero length still exists and still owns its cell —
    // dropping it here would let the next edit create a second entry beside it.
    const effective =
      slices.length > 0
        ? slices
        : [
            {
              date: splitIntervalByZonedDay(startMs, startMs + 1, args.timeZone)[0]
                ?.date,
              seconds: 0,
            },
          ];

    const key = timesheetRowKey(entry.projectId, entry.taskId);
    const row =
      rows.get(key) ??
      emptyRow(
        { projectId: entry.projectId, taskId: entry.taskId },
        days,
        false
      );
    // An entry always knows its own labels; a pinned row keeps the ones the
    // catalog gave it only until a real entry supplies better.
    row.label = rowLabel(entry.projectName, entry.taskName);
    row.color = entry.projectColor ?? row.color;
    rows.set(key, row);

    for (const slice of effective) {
      if (slice.date === undefined) continue;
      const index = dayIndex.get(slice.date);
      if (index === undefined) continue;

      const cell = row.cells[index];
      if (cell === undefined) continue;

      cell.seconds += slice.seconds;
      cell.entries.push({
        id: entry.id,
        start: entry.start,
        end: entry.end,
        secondsInCell: slice.seconds,
        containedInDay: effective.length === 1,
        running,
      });
      row.totalSec += slice.seconds;
    }
  }

  const sorted = [...rows.values()].sort(byLabel);
  const dayTotals = days.map((_day, index) =>
    sorted.reduce((total, row) => total + (row.cells[index]?.seconds ?? 0), 0)
  );

  return {
    days,
    rows: sorted,
    dayTotals,
    totalSec: dayTotals.reduce((total, seconds) => total + seconds, 0),
  };
};

// ── cell state ───────────────────────────────────────────────────────

/**
 * What a cell is, which decides how it renders BEFORE anything is typed:
 *
 *  - `empty`    — writable, creates an entry
 *  - `single`   — writable, adjusts the one entry behind it
 *  - `multiple` — read-only, shows a breakdown
 *  - `split`    — read-only, its entry belongs to two days
 *  - `running`  — read-only, the timer owns it
 */
export type TimesheetCellState =
  | "empty"
  | "single"
  | "multiple"
  | "split"
  | "running";

export const timesheetCellState = (cell: TimesheetCell): TimesheetCellState => {
  if (cell.entries.some((entry) => entry.running)) return "running";
  if (cell.entries.length === 0) return "empty";
  if (cell.entries.length > 1) return "multiple";
  return cell.entries[0]?.containedInDay === false ? "split" : "single";
};

export const isTimesheetCellEditable = (cell: TimesheetCell): boolean => {
  const state = timesheetCellState(cell);
  return state === "empty" || state === "single";
};

// ── cell edit planning ───────────────────────────────────────────────

export type TimesheetRefusal =
  | "running"
  | "multiple"
  | "spans-days"
  | "too-long";

export type TimesheetCellPlan =
  | { kind: "noop" }
  | { kind: "create"; start: string; end: string; seconds: number }
  | { kind: "adjust"; id: string; end: string; seconds: number }
  | { kind: "delete"; id: string }
  | { kind: "refuse"; reason: TimesheetRefusal };

/** Human wording for a refusal, shared by the cell tooltip and the toast. */
export const timesheetRefusalMessage = (reason: TimesheetRefusal): string => {
  switch (reason) {
    case "running":
      return "This cell holds the running timer — stop it before editing.";
    case "multiple":
      return "This day has several entries for this row. Edit them in the tracker so nothing is rewritten by guesswork.";
    case "spans-days":
      return "This entry crosses midnight, so it belongs to two days. Edit it in the tracker.";
    case "too-long":
      return "A day cannot hold more than 24 hours.";
  }
};

/**
 * Where a newly created cell entry starts.
 *
 * Normally 09:00 local (see `TIMESHEET_START_HOUR`). A duration that would not
 * fit between 09:00 and midnight is anchored to the END of the day instead, so
 * a long cell stays inside the day it was typed into rather than spilling into
 * the next one and showing up in the wrong column.
 */
export const cellStartMs = (
  dayKey: DayKey,
  timeZone: string,
  seconds: number
): number => {
  const dayStart = zonedDayStartMs(dayKey, timeZone);
  const dayEnd = zonedDayStartMs(addDaysToKey(dayKey, 1), timeZone);
  const [year, month, day] = dayKey.split("-").map(Number);

  const preferred = zonedWallClockToMs(
    {
      year: year ?? 0,
      month: month ?? 1,
      day: day ?? 1,
      hour: TIMESHEET_START_HOUR,
    },
    timeZone
  );

  const latest = dayEnd - seconds * MS_PER_SECOND;
  return Math.max(dayStart, Math.min(preferred, latest));
};

/** Real elapsed seconds in a calendar day — 23 or 25 hours across a DST shift. */
const daySeconds = (dayKey: DayKey, timeZone: string): number =>
  Math.round(
    (zonedDayStartMs(addDaysToKey(dayKey, 1), timeZone) -
      zonedDayStartMs(dayKey, timeZone)) /
      MS_PER_SECOND
  );

/**
 * Resolve a typed cell total into the single write it means, or into a refusal.
 *
 * Pure and total: it never performs a mutation and never picks an entry to
 * rewrite when more than one is in play. See the rules at the top of the file.
 */
export const planCellEdit = (args: {
  cell: TimesheetCell;
  timeZone: string;
  /** The total the user typed, in seconds. */
  targetSeconds: number;
}): TimesheetCellPlan => {
  const { cell, timeZone } = args;
  const target = Math.max(0, Math.round(args.targetSeconds));
  const state = timesheetCellState(cell);

  if (state === "running") return { kind: "refuse", reason: "running" };
  if (state === "multiple") return { kind: "refuse", reason: "multiple" };
  if (state === "split") return { kind: "refuse", reason: "spans-days" };

  if (target === Math.round(cell.seconds)) return { kind: "noop" };

  const limit = Math.min(
    TIMESHEET_MAX_CELL_SECONDS,
    daySeconds(cell.day, timeZone)
  );
  if (target > limit) return { kind: "refuse", reason: "too-long" };

  if (state === "empty") {
    if (target === 0) return { kind: "noop" };
    const startMs = cellStartMs(cell.day, timeZone, target);
    return {
      kind: "create",
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + target * MS_PER_SECOND).toISOString(),
      seconds: target,
    };
  }

  const only = cell.entries[0];
  if (only === undefined) return { kind: "noop" };
  if (target === 0) return { kind: "delete", id: only.id };

  const startMs = Date.parse(only.start);
  if (Number.isNaN(startMs)) return { kind: "noop" };

  const dayEnd = zonedDayStartMs(addDaysToKey(cell.day, 1), timeZone);
  const endMs = startMs + target * MS_PER_SECOND;
  // Lengthening past midnight would move time into the NEXT day's cell, which
  // is not what was typed into this one.
  if (endMs > dayEnd) return { kind: "refuse", reason: "too-long" };

  return {
    kind: "adjust",
    id: only.id,
    end: new Date(endMs).toISOString(),
    seconds: target,
  };
};

// ── week arithmetic ──────────────────────────────────────────────────

/** The seven day keys of the week beginning at `weekStartKey`. */
export const timesheetWeekDays = (weekStart: DayKey): DayKey[] => {
  const days: DayKey[] = [];
  for (let index = 0; index < TIMESHEET_DAYS; index += 1) {
    days.push(addDaysToKey(weekStart, index));
  }
  return days;
};
