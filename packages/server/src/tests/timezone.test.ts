import assert from "node:assert/strict";
import test from "node:test";
// Subpath import: a bare named import from "@starter/shared" throws under tsx.
// See the note in duration.test.ts.
import {
  addDaysToKey,
  dayKeyInZone,
  dayKeysBetween,
  monthKeyOf,
  resolveTimeZone,
  splitIntervalByZonedDay,
  weekStartKey,
  weekdayOfKey,
  zonedDayStartMs,
  zonedWallClockToMs,
  wallClockInZone,
  formatClockInZone,
  parseTimeOfDayInZone,
  withDayInZone,
  spansDayBoundaryInZone,
  zoneLabel,
  isSameZone,
} from "@starter/shared/timezone";

const HOUR = 3_600_000;

// ── dayKeyInZone ─────────────────────────────────────────────────────

test("an instant lands on different calendar days in different zones", () => {
  // 2026-08-21T23:30:00Z — already the 22nd in Berlin, still the 21st in UTC,
  // and still the 21st (evening) in New York.
  const ms = Date.parse("2026-08-21T23:30:00.000Z");

  assert.equal(dayKeyInZone(ms, "UTC"), "2026-08-21");
  assert.equal(dayKeyInZone(ms, "Europe/Berlin"), "2026-08-22");
  assert.equal(dayKeyInZone(ms, "America/New_York"), "2026-08-21");
});

test("a zone behind UTC can fall on the previous day", () => {
  const ms = Date.parse("2026-08-21T03:00:00.000Z");
  assert.equal(dayKeyInZone(ms, "UTC"), "2026-08-21");
  assert.equal(dayKeyInZone(ms, "America/Los_Angeles"), "2026-08-20");
});

// ── zonedDayStartMs ──────────────────────────────────────────────────

test("a day starts at the zone's midnight, not UTC midnight", () => {
  // Berlin is UTC+2 in August, so the day begins at 22:00Z the day before.
  assert.equal(
    zonedDayStartMs("2026-08-21", "Europe/Berlin"),
    Date.parse("2026-08-20T22:00:00.000Z"),
  );
  assert.equal(
    zonedDayStartMs("2026-08-21", "UTC"),
    Date.parse("2026-08-21T00:00:00.000Z"),
  );
});

test("day start is correct on both sides of a DST shift", () => {
  // Berlin springs forward 2026-03-29 (UTC+1 → UTC+2).
  assert.equal(
    zonedDayStartMs("2026-03-28", "Europe/Berlin"),
    Date.parse("2026-03-27T23:00:00.000Z"),
  );
  assert.equal(
    zonedDayStartMs("2026-03-29", "Europe/Berlin"),
    Date.parse("2026-03-28T23:00:00.000Z"),
  );
  // The day AFTER the shift begins an hour earlier in UTC terms.
  assert.equal(
    zonedDayStartMs("2026-03-30", "Europe/Berlin"),
    Date.parse("2026-03-29T22:00:00.000Z"),
  );
});

test("round-tripping an instant through its day key stays in the same day", () => {
  const zones = ["UTC", "Europe/Berlin", "America/New_York", "Asia/Kolkata"];
  const ms = Date.parse("2026-08-21T13:45:00.000Z");
  for (const zone of zones) {
    const key = dayKeyInZone(ms, zone);
    const start = zonedDayStartMs(key, zone);
    assert.ok(start <= ms, `${zone}: day start must not be after the instant`);
    assert.equal(dayKeyInZone(start, zone), key, `${zone}: start is in its day`);
  }
});

test("a half-hour zone is handled", () => {
  // Kolkata is UTC+5:30 year round.
  assert.equal(
    zonedDayStartMs("2026-08-21", "Asia/Kolkata"),
    Date.parse("2026-08-20T18:30:00.000Z"),
  );
});

// ── key arithmetic ───────────────────────────────────────────────────

test("addDaysToKey crosses months and years", () => {
  assert.equal(addDaysToKey("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysToKey("2026-01-01", -1), "2025-12-31");
  assert.equal(addDaysToKey("2028-02-28", 1), "2028-02-29");
});

test("weekdayOfKey and weekStartKey honour the week start", () => {
  // 2026-08-21 is a Friday.
  assert.equal(weekdayOfKey("2026-08-21"), 5);
  assert.equal(weekStartKey("2026-08-21", 1), "2026-08-17");
  assert.equal(weekStartKey("2026-08-21", 0), "2026-08-16");
  // A Sunday with a Monday-start week belongs to the week that began six days ago.
  assert.equal(weekStartKey("2026-08-23", 1), "2026-08-17");
  assert.equal(weekStartKey("2026-08-23", 0), "2026-08-23");
});

test("dayKeysBetween is inclusive and ascending", () => {
  assert.deepEqual(dayKeysBetween("2026-08-30", "2026-09-02"), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
  ]);
  assert.deepEqual(dayKeysBetween("2026-08-30", "2026-08-30"), ["2026-08-30"]);
  assert.deepEqual(dayKeysBetween("2026-08-30", "2026-08-29"), []);
});

test("monthKeyOf trims a day key to its month", () => {
  assert.equal(monthKeyOf("2026-08-21"), "2026-08");
});

// ── splitIntervalByZonedDay ──────────────────────────────────────────

test("an entry inside one day is a single slice", () => {
  const start = Date.parse("2026-08-21T09:00:00.000Z");
  const slices = splitIntervalByZonedDay(start, start + 2 * HOUR, "Europe/Berlin");
  assert.deepEqual(slices, [{ date: "2026-08-21", seconds: 7200 }]);
});

test("an entry crossing local midnight splits across two days", () => {
  // 23:30 → 00:30 Berlin time.
  const start = Date.parse("2026-08-21T21:30:00.000Z");
  const end = Date.parse("2026-08-21T22:30:00.000Z");
  const slices = splitIntervalByZonedDay(start, end, "Europe/Berlin");

  assert.deepEqual(slices, [
    { date: "2026-08-21", seconds: 1800 },
    { date: "2026-08-22", seconds: 1800 },
  ]);
  // The same instants are one uninterrupted day in UTC.
  assert.deepEqual(splitIntervalByZonedDay(start, end, "UTC"), [
    { date: "2026-08-21", seconds: 3600 },
  ]);
});

test("slice seconds always sum to the real elapsed time", () => {
  const start = Date.parse("2026-08-20T15:00:00.000Z");
  const end = Date.parse("2026-08-23T04:00:00.000Z");
  const elapsed = Math.round((end - start) / 1000);

  for (const zone of ["UTC", "Europe/Berlin", "America/New_York", "Asia/Kolkata"]) {
    const total = splitIntervalByZonedDay(start, end, zone).reduce(
      (sum, slice) => sum + slice.seconds,
      0,
    );
    assert.equal(total, elapsed, `${zone} lost or invented time`);
  }
});

test("a DST day reports the time that actually elapsed, not a nominal 24h", () => {
  // Berlin's spring-forward day is only 23 hours long.
  const dayStart = zonedDayStartMs("2026-03-29", "Europe/Berlin");
  const nextStart = zonedDayStartMs("2026-03-30", "Europe/Berlin");
  const slices = splitIntervalByZonedDay(dayStart, nextStart, "Europe/Berlin");

  assert.deepEqual(slices, [{ date: "2026-03-29", seconds: 23 * 3600 }]);
});

test("a zero-length or reversed interval yields nothing", () => {
  const ms = Date.parse("2026-08-21T09:00:00.000Z");
  assert.deepEqual(splitIntervalByZonedDay(ms, ms, "UTC"), []);
  assert.deepEqual(splitIntervalByZonedDay(ms, ms - HOUR, "UTC"), []);
});

// ── resolveTimeZone ──────────────────────────────────────────────────

test("an unusable zone falls back to UTC instead of throwing", () => {
  assert.equal(resolveTimeZone("Europe/Berlin"), "Europe/Berlin");
  assert.equal(resolveTimeZone("Not/AZone"), "UTC");
  assert.equal(resolveTimeZone(""), "UTC");
  assert.equal(resolveTimeZone(null), "UTC");
  assert.equal(resolveTimeZone(undefined), "UTC");
});

// ── wall clock in an explicit zone ───────────────────────────────────

test("zonedWallClockToMs is the inverse of reading a clock", () => {
  // 23:30 on 2026-08-21 in Berlin (UTC+2 in August) is 21:30Z.
  const ms = zonedWallClockToMs(
    { year: 2026, month: 8, day: 21, hour: 23, minute: 30 },
    "Europe/Berlin",
  );
  assert.equal(new Date(ms).toISOString(), "2026-08-21T21:30:00.000Z");
  assert.deepEqual(wallClockInZone(ms, "Europe/Berlin"), {
    year: 2026,
    month: 8,
    day: 21,
    hour: 23,
    minute: 30,
    second: 0,
  });
});

test("the same wall clock is a different instant in each zone", () => {
  const clock = { year: 2026, month: 8, day: 21, hour: 9, minute: 0 };
  const berlin = zonedWallClockToMs(clock, "Europe/Berlin");
  const tokyo = zonedWallClockToMs(clock, "Asia/Tokyo");
  const utc = zonedWallClockToMs(clock, "UTC");

  assert.equal(new Date(berlin).toISOString(), "2026-08-21T07:00:00.000Z");
  assert.equal(new Date(tokyo).toISOString(), "2026-08-21T00:00:00.000Z");
  assert.equal(new Date(utc).toISOString(), "2026-08-21T09:00:00.000Z");
});

test("formatClockInZone shows the time the entry was recorded at", () => {
  // The instant is fixed; only the zone it is read in changes.
  const iso = "2026-08-21T21:30:00.000Z";
  assert.equal(formatClockInZone(iso, "Europe/Berlin"), "23:30");
  assert.equal(formatClockInZone(iso, "UTC"), "21:30");
  assert.equal(formatClockInZone(iso, "Asia/Tokyo"), "06:30");
  assert.equal(formatClockInZone(iso, "Europe/Berlin", "12h"), "11:30 pm");
});

// ── the drift this whole feature exists to prevent ───────────────────

test("editing a time in the entry's own zone does not move the entry", () => {
  // Recorded at 23:30 Berlin. Someone in Tokyo opens it, sees "23:30", and
  // retypes the same value. The instant must not budge.
  const recorded = "2026-08-21T21:30:00.000Z";
  const shown = formatClockInZone(recorded, "Europe/Berlin");
  assert.equal(shown, "23:30");

  const reparsed = parseTimeOfDayInZone(shown, recorded, "Europe/Berlin");
  assert.equal(reparsed, recorded);
});

test("parsing the same keystrokes in the viewer's zone WOULD move it", () => {
  // This is the bug being prevented. The entry is 23:30 on 21 Aug in Berlin,
  // but a viewer in Tokyo sees it as 06:30 on the 22nd — so interpreting the
  // unchanged text "23:30" as Tokyo time anchors it to the 22nd AND shifts the
  // offset, moving the entry 17 hours later.
  const recorded = "2026-08-21T21:30:00.000Z";
  const wrong = parseTimeOfDayInZone("23:30", recorded, "Asia/Tokyo");

  assert.notEqual(wrong, recorded);
  assert.equal(wrong, "2026-08-22T14:30:00.000Z");
  assert.equal(
    (Date.parse(wrong ?? "") - Date.parse(recorded)) / 3_600_000,
    17,
  );
});

test("parseTimeOfDayInZone accepts the same formats as the local parser", () => {
  const anchor = "2026-08-21T21:30:00.000Z"; // 23:30 Berlin
  const inZone = (raw: string): string | null =>
    parseTimeOfDayInZone(raw, anchor, "Europe/Berlin");

  assert.equal(inZone("9:15"), "2026-08-21T07:15:00.000Z");
  assert.equal(inZone("0915"), "2026-08-21T07:15:00.000Z");
  assert.equal(inZone("9:15 pm"), "2026-08-21T19:15:00.000Z");
  assert.equal(inZone("12am"), "2026-08-20T22:00:00.000Z");
  assert.equal(inZone("nonsense"), null);
  assert.equal(inZone(""), null);
});

test("a wall clock skipped by a spring-forward resolves to a real instant", () => {
  // Berlin jumps 02:00 -> 03:00 on 2026-03-29, so 02:30 never happens.
  const ms = zonedWallClockToMs(
    { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
    "Europe/Berlin",
  );
  assert.ok(Number.isFinite(ms), "must still yield an instant");
  // Whatever it lands on must be a real reading in that zone.
  const back = wallClockInZone(ms, "Europe/Berlin");
  assert.equal(back.day, 29);
});

// ── day re-anchoring and boundaries ──────────────────────────────────

test("withDayInZone moves the date and keeps the clock time", () => {
  const iso = "2026-08-21T21:30:00.000Z"; // 23:30 Berlin
  const moved = withDayInZone(iso, "2026-08-25", "Europe/Berlin");

  assert.equal(formatClockInZone(moved, "Europe/Berlin"), "23:30");
  assert.equal(dayKeyInZone(Date.parse(moved), "Europe/Berlin"), "2026-08-25");
});

test("spansDayBoundaryInZone is answered in the entry's zone, not the viewer's", () => {
  // 23:30 -> 00:30 Berlin crosses midnight there, but not in UTC.
  const start = "2026-08-21T21:30:00.000Z";
  const end = "2026-08-21T22:30:00.000Z";

  assert.equal(spansDayBoundaryInZone(start, end, "Europe/Berlin"), true);
  assert.equal(spansDayBoundaryInZone(start, end, "UTC"), false);
  assert.equal(spansDayBoundaryInZone(start, null, "Europe/Berlin"), false);
});

test("zoneLabel reads the way a person would say it", () => {
  assert.equal(zoneLabel("Europe/Berlin"), "Berlin");
  assert.equal(zoneLabel("America/New_York"), "New York");
  assert.equal(zoneLabel("UTC"), "UTC");
});

test("isSameZone compares the reading, not the identifier", () => {
  const august = Date.parse("2026-08-21T12:00:00.000Z");
  assert.equal(isSameZone("Europe/Berlin", "Europe/Berlin", august), true);
  // Same offset rules, different names — the clock reads identically.
  assert.equal(isSameZone("Europe/Berlin", "Europe/Vienna", august), true);
  assert.equal(isSameZone("Europe/Berlin", "Asia/Tokyo", august), false);
  // An unusable zone resolves to UTC rather than throwing.
  assert.equal(isSameZone("Not/AZone", "UTC", august), true);
});
