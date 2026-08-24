import assert from "node:assert/strict";
import test from "node:test";
// Subpath import: a bare named import from "@starter/shared" throws under tsx.
// See the note in duration.test.ts.
import {
  createEntrySchema,
  createProjectSchema,
  entryListSchema,
  hexColorSchema,
  hourlyRateSchema,
  isoDateOrDateTimeSchema,
  isoDateTimeSchema,
  pomodoroSettingsSchema,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
  updateSettingsSchema,
} from "@starter/shared/schemas";

/** `true` when the value passes the schema. */
const accepts = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown
): boolean => schema.safeParse(value).success;

// ── primitives ───────────────────────────────────────────────────────

test("hexColorSchema takes 6-digit hex colors only", () => {
  assert.ok(accepts(hexColorSchema, "#4f46e5"));
  assert.ok(accepts(hexColorSchema, "#FFFFFF"));
  assert.ok(!accepts(hexColorSchema, "4f46e5"), "the # is required");
  assert.ok(!accepts(hexColorSchema, "#fff"), "shorthand is not accepted");
  assert.ok(!accepts(hexColorSchema, "#12345g"));
  assert.ok(!accepts(hexColorSchema, "#4f46e55"));
  assert.ok(!accepts(hexColorSchema, "rebeccapurple"));
});

test("isoDateTimeSchema requires a timezone", () => {
  assert.ok(accepts(isoDateTimeSchema, "2026-08-21T09:15:00Z"));
  assert.ok(accepts(isoDateTimeSchema, "2026-08-21T09:15:00.000Z"));
  assert.ok(accepts(isoDateTimeSchema, "2026-08-21T09:15:00+02:00"));
  assert.ok(
    !accepts(isoDateTimeSchema, "2026-08-21T09:15:00"),
    "a local datetime is ambiguous on the wire"
  );
  assert.ok(!accepts(isoDateTimeSchema, "2026-08-21"));
  assert.ok(!accepts(isoDateTimeSchema, "21/08/2026"));
  assert.ok(!accepts(isoDateTimeSchema, ""));
});

test("isoDateOrDateTimeSchema takes a calendar day or a full timestamp", () => {
  assert.ok(accepts(isoDateOrDateTimeSchema, "2026-08-21"));
  assert.ok(accepts(isoDateOrDateTimeSchema, "2026-08-21T09:15:00Z"));
  assert.ok(!accepts(isoDateOrDateTimeSchema, "2026-8-21"));
  assert.ok(!accepts(isoDateOrDateTimeSchema, "2026-13-01"));
});

test("hourlyRateSchema takes a non-negative rate", () => {
  assert.ok(accepts(hourlyRateSchema, 0));
  assert.ok(accepts(hourlyRateSchema, 99.5));
  assert.ok(!accepts(hourlyRateSchema, -1));
  assert.ok(!accepts(hourlyRateSchema, 1_000_001));
  assert.ok(!accepts(hourlyRateSchema, "60"));
});

// ── timer ────────────────────────────────────────────────────────────

test("startTimerSchema accepts an empty start — the server fills the blanks", () => {
  assert.ok(accepts(startTimerSchema, {}));
  assert.ok(
    accepts(startTimerSchema, {
      description: "Wrote tests",
      projectId: "p1",
      taskId: null,
      billable: true,
      start: "2026-08-21T09:15:00Z",
      source: "desktop",
      originId: "tab-1",
    })
  );
});

test("startTimerSchema rejects unknown sources and oversized fields", () => {
  assert.ok(!accepts(startTimerSchema, { source: "watch" }));
  assert.ok(!accepts(startTimerSchema, { description: "x".repeat(501) }));
  assert.ok(!accepts(startTimerSchema, { originId: "o".repeat(65) }));
  assert.ok(!accepts(startTimerSchema, { projectId: "" }));
  assert.ok(!accepts(startTimerSchema, { start: "2026-08-21" }));
});

test("stopTimerSchema works with no arguments at all", () => {
  assert.ok(accepts(stopTimerSchema, {}));
  assert.ok(accepts(stopTimerSchema, { end: "2026-08-21T10:00:00Z" }));
  assert.ok(!accepts(stopTimerSchema, { id: "" }));
});

// ── manual entries ───────────────────────────────────────────────────

test("createEntrySchema requires both bounds and defaults the description", () => {
  const parsed = createEntrySchema.safeParse({
    start: "2026-08-21T09:00:00Z",
    end: "2026-08-21T10:00:00Z",
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.description, "");

  assert.ok(!accepts(createEntrySchema, { start: "2026-08-21T09:00:00Z" }));
  assert.ok(!accepts(createEntrySchema, { end: "2026-08-21T10:00:00Z" }));
});

test("createEntrySchema refuses an end that is not after the start", () => {
  const sameInstant = {
    start: "2026-08-21T09:00:00Z",
    end: "2026-08-21T09:00:00Z",
  };
  assert.ok(!accepts(createEntrySchema, sameInstant), "zero-length entry");
  assert.ok(
    !accepts(createEntrySchema, {
      start: "2026-08-21T10:00:00Z",
      end: "2026-08-21T09:00:00Z",
    }),
    "backwards entry"
  );

  const result = createEntrySchema.safeParse(sameInstant);
  assert.ok(!result.success);
  assert.deepEqual(result.error.issues[0].path, ["end"]);
});

test("createEntrySchema compares instants, not strings", () => {
  // Same moment expressed in two zones — still zero length, still rejected.
  assert.ok(
    !accepts(createEntrySchema, {
      start: "2026-08-21T09:00:00Z",
      end: "2026-08-21T11:00:00+02:00",
    })
  );
  assert.ok(
    accepts(createEntrySchema, {
      start: "2026-08-21T09:00:00Z",
      end: "2026-08-21T12:00:00+02:00",
    })
  );
});

test("updateEntrySchema allows null end to keep an entry running", () => {
  assert.ok(accepts(updateEntrySchema, { id: "e1", end: null }));
  assert.ok(accepts(updateEntrySchema, { id: "e1", start: "2026-08-21T09:00:00Z" }));
  assert.ok(
    accepts(updateEntrySchema, { id: "e1", end: "2026-08-21T10:00:00Z" }),
    "an end alone is checked against the stored start server-side"
  );
  assert.ok(
    !accepts(updateEntrySchema, {
      id: "e1",
      start: "2026-08-21T10:00:00Z",
      end: "2026-08-21T09:00:00Z",
    })
  );
  assert.ok(!accepts(updateEntrySchema, { end: null }), "the id is required");
});

test("entryListSchema bounds the page size", () => {
  const range = { from: "2026-08-01", to: "2026-08-31" };
  assert.ok(accepts(entryListSchema, range));
  assert.ok(accepts(entryListSchema, { ...range, limit: 500 }));
  assert.ok(!accepts(entryListSchema, { ...range, limit: 501 }));
  assert.ok(!accepts(entryListSchema, { ...range, limit: 0 }));
  assert.ok(!accepts(entryListSchema, { ...range, limit: 10.5 }));
  assert.ok(!accepts(entryListSchema, { to: "2026-08-31" }));
  assert.ok(!accepts(entryListSchema, { ...range, search: "s".repeat(201) }));
});

// ── catalog ──────────────────────────────────────────────────────────

test("createProjectSchema treats client and rate as optional and nullable", () => {
  assert.ok(accepts(createProjectSchema, { name: "tracktime" }));
  assert.ok(
    accepts(createProjectSchema, {
      name: "tracktime",
      color: "#4f46e5",
      clientId: null,
      billableDefault: false,
      hourlyRate: null,
    })
  );
  assert.ok(!accepts(createProjectSchema, { name: "" }));
  assert.ok(!accepts(createProjectSchema, { name: "x".repeat(121) }));
  assert.ok(!accepts(createProjectSchema, { name: "ok", hourlyRate: -5 }));
});

// ── settings ─────────────────────────────────────────────────────────

test("updateSettingsSchema demands an uppercase ISO 4217 code", () => {
  assert.ok(accepts(updateSettingsSchema, { currency: "EUR" }));
  assert.ok(!accepts(updateSettingsSchema, { currency: "eur" }));
  assert.ok(!accepts(updateSettingsSchema, { currency: "EURO" }));
  assert.ok(!accepts(updateSettingsSchema, { currency: "€" }));
});

test("updateSettingsSchema keeps every field optional and patches pomodoro", () => {
  assert.ok(accepts(updateSettingsSchema, {}));
  assert.ok(accepts(updateSettingsSchema, { pomodoro: { workMinutes: 50 } }));
  assert.ok(accepts(updateSettingsSchema, { weekStartsOn: 0 }));
  assert.ok(accepts(updateSettingsSchema, { weekStartsOn: 1 }));
  assert.ok(!accepts(updateSettingsSchema, { weekStartsOn: 2 }));
  assert.ok(!accepts(updateSettingsSchema, { timeFormat: "48h" }));
  assert.ok(!accepts(updateSettingsSchema, { durationFormat: "clock" }));
});

test("pomodoroSettingsSchema bounds every interval", () => {
  const valid = {
    enabled: true,
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    notify: true,
  };
  assert.ok(accepts(pomodoroSettingsSchema, valid));
  assert.ok(!accepts(pomodoroSettingsSchema, { ...valid, workMinutes: 0 }));
  assert.ok(!accepts(pomodoroSettingsSchema, { ...valid, workMinutes: 181 }));
  assert.ok(!accepts(pomodoroSettingsSchema, { ...valid, workMinutes: 25.5 }));
  assert.ok(!accepts(pomodoroSettingsSchema, { ...valid, cyclesBeforeLongBreak: 13 }));
  assert.ok(!accepts(pomodoroSettingsSchema, { ...valid, notify: "yes" }));
  const { notify: _notify, ...missingNotify } = valid;
  assert.ok(!accepts(pomodoroSettingsSchema, missingNotify));
});
