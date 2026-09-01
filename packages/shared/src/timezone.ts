/**
 * Calendar arithmetic in an explicit IANA time zone.
 *
 * Every instant this app stores is absolute (a UTC millisecond), so a duration
 * is always real elapsed time no matter which device measured it. What is NOT
 * absolute is which *calendar day* an instant belongs to: 00:30 in Berlin is
 * 23:30 the previous day in UTC.
 *
 * The reporting code used to answer that question with the host's own local
 * time — meaning the SERVER's zone, which on a deployment is usually UTC. A
 * user in Berlin tracking after midnight had that time filed under the previous
 * day in every report, while the tracker list (grouped in the browser) filed it
 * under the right one. The two screens disagreed about the same entry.
 *
 * These helpers take the zone as an argument so the answer never depends on
 * where the code happens to run.
 */

/** A calendar date, "YYYY-MM-DD". Never an instant. */
export type DayKey = string;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/**
 * `true` when the runtime accepts this zone. Intl throws a RangeError for an
 * unknown identifier, and a bad zone from a client must not take a report down.
 */
export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** The given zone if usable, else UTC. */
export const resolveTimeZone = (timeZone: string | null | undefined): string =>
  timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = partsFormatter.get(timeZone);
  if (cached) return cached;
  // en-CA renders dates as YYYY-MM-DD, which is the key format directly.
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  partsFormatter.set(timeZone, created);
  return created;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedParts = (ms: number, timeZone: string): ZonedParts => {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // Some engines render midnight as hour 24 rather than 0.
  const hour = read("hour") % 24;

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
};

/** Milliseconds the zone is ahead of UTC at this instant. */
const zoneOffsetMs = (ms: number, timeZone: string): number => {
  const p = zonedParts(ms, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard the sub-second remainder so the offset is a whole number of seconds.
  return asIfUtc - Math.floor(ms / 1000) * 1000;
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** The calendar day an instant falls on, in `timeZone`. */
export const dayKeyInZone = (ms: number, timeZone: string): DayKey => {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** Split a key into its numeric parts. */
const keyParts = (key: DayKey): { y: number; m: number; d: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
};

/**
 * The instant at which that calendar day begins in `timeZone`.
 *
 * Resolved in two passes: guess using the offset at UTC midnight, then re-read
 * the offset at the guessed instant. The second pass is what makes DST
 * transitions come out right, since the offset before and after a shift differ.
 * On a spring-forward day where local midnight does not exist, this lands on
 * the first instant that does.
 */
export const zonedDayStartMs = (key: DayKey, timeZone: string): number => {
  const parts = keyParts(key);
  if (!parts) return Number.NaN;

  const utcMidnight = Date.UTC(parts.y, parts.m - 1, parts.d);
  const firstGuess = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  return utcMidnight - zoneOffsetMs(firstGuess, timeZone);
};

/** Calendar-day arithmetic. Independent of any zone — keys are just dates. */
export const addDaysToKey = (key: DayKey, days: number): DayKey => {
  const parts = keyParts(key);
  if (!parts) return key;
  const moved = new Date(Date.UTC(parts.y, parts.m - 1, parts.d) + days * MS_PER_DAY);
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(
    moved.getUTCDate()
  )}`;
};

/** Day of the week for a key, 0 = Sunday. */
export const weekdayOfKey = (key: DayKey): number => {
  const parts = keyParts(key);
  if (!parts) return 0;
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
};

/** The key of the week's first day, honouring `weekStartsOn` (0=Sun, 1=Mon). */
export const weekStartKey = (key: DayKey, weekStartsOn: 0 | 1): DayKey => {
  const shift = (weekdayOfKey(key) - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDaysToKey(key, -shift);
};

/** "YYYY-MM" for a key. */
export const monthKeyOf = (key: DayKey): string => key.slice(0, 7);

/** Every key from `fromKey` to `toKey` inclusive, ascending. */
export const dayKeysBetween = (fromKey: DayKey, toKey: DayKey): DayKey[] => {
  const keys: DayKey[] = [];
  let cursor = fromKey;
  // Bounded so a malformed key can never spin here.
  for (let guard = 0; guard < 4000 && cursor <= toKey; guard += 1) {
    keys.push(cursor);
    cursor = addDaysToKey(cursor, 1);
  }
  return keys;
};

/**
 * Split an interval into per-calendar-day slices in `timeZone`.
 *
 * Seconds are measured between instants, so a slice spanning a DST shift
 * reports the time that actually elapsed — a "23-hour day" is 23 hours, not 24.
 */
export const splitIntervalByZonedDay = (
  startMs: number,
  endMs: number,
  timeZone: string
): { date: DayKey; seconds: number }[] => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  if (endMs <= startMs) return [];

  const slices: { date: DayKey; seconds: number }[] = [];
  let cursor = startMs;

  for (let guard = 0; guard < 400 && cursor < endMs; guard += 1) {
    const key = dayKeyInZone(cursor, timeZone);
    const nextDayStart = zonedDayStartMs(addDaysToKey(key, 1), timeZone);
    // Guard against a zone where the next boundary fails to advance.
    const boundary = nextDayStart > cursor ? nextDayStart : cursor + MS_PER_DAY;
    const sliceEnd = Math.min(boundary, endMs);

    slices.push({
      date: key,
      seconds: Math.max(0, Math.round((sliceEnd - cursor) / 1000)),
    });
    cursor = sliceEnd;
  }

  return slices;
};
