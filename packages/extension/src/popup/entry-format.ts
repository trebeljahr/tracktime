/**
 * How an entry reads in a 380px list.
 *
 * Every formatter here delegates to `@starter/shared` and then trims: the
 * shared helpers are written for a screen with room, and the popup's job is to
 * decide what to drop, never to re-implement how a duration or a clock time is
 * spelled.
 */
import {
  addDaysToKey,
  deviceTimeZone,
  formatClockInZone,
  formatDuration,
  type DayKey,
  type DetailedEntry,
  type DurationFormat,
  type TimeEntry,
  type TimeFormat,
} from "@starter/core";

/**
 * A ticking clock in the user's own duration format.
 *
 * The format is a parameter rather than a constant because the popup can now
 * set it, and a running clock that stayed h:mm:ss would put two spellings of a
 * duration on one screen. In h:mm:ss the leading "0:" is trimmed: at 380px it
 * is noise for the first hour, which is where most entries live. Decimal has
 * nothing to trim, so the branch simply does not fire.
 */
export function formatElapsed(
  seconds: number,
  format: DurationFormat,
): string {
  const shown = formatDuration(seconds, format);
  return shown.startsWith("0:") ? shown.slice(2) : shown;
}

/**
 * The zone an entry's clock times mean.
 *
 * Falling back to this device is what stops a row recorded before entries
 * carried a zone from rendering as an empty string; using the entry's own zone
 * where it has one is what stops a Berlin entry reading 07:30 in Tokyo.
 */
export function entryZone(entry: Pick<TimeEntry, "timeZone">): string {
  return entry.timeZone ?? deviceTimeZone();
}

/** "09:00–10:24", in the user's own clock format. */
export function entryRangeLabel(
  entry: Pick<TimeEntry, "start" | "end" | "timeZone">,
  timeFormat: TimeFormat,
): string {
  const zone = entryZone(entry);
  const start = formatClockInZone(entry.start, zone, timeFormat);
  // An open end is a running entry, which the list never shows — but a row
  // rendered from the offline overlay can reach here mid-write.
  const end =
    entry.end === null ? "…" : formatClockInZone(entry.end, zone, timeFormat);
  return `${start}–${end}`;
}

/** "Today", "Yesterday", else "Fri 5 Sep". */
export function entryDayLabel(dayKey: DayKey, todayKey: DayKey): string {
  if (dayKey === todayKey) return "Today";
  if (dayKey === addDaysToKey(todayKey, -1)) return "Yesterday";

  // Parsed and rendered in UTC on purpose: the key already names a calendar
  // day in the entry's own zone, so letting the device's offset reinterpret it
  // is exactly how a date slips by one.
  const ms = Date.parse(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(ms)) return dayKey;
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** An entry with no description is a real state, not a blank row. */
export function entryTitle(entry: Pick<TimeEntry, "description">): string {
  const trimmed = entry.description.trim();
  return trimmed === "" ? "No description" : trimmed;
}

/** "Acme · Landing page" — the denormalized labels the server already sent. */
export function entrySubtitle(entry: DetailedEntry): string {
  const parts = [entry.clientName, entry.projectName, entry.taskName].filter(
    (part): part is string => part !== null && part !== "",
  );
  return parts.length === 0 ? "No project" : parts.join(" · ");
}
