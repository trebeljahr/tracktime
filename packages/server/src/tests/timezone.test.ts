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
