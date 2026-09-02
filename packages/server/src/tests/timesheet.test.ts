import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimesheetGrid,
  cellStartMs,
  dayKeyInZone,
  formatTimesheetCell,
  isTimesheetCellEditable,
  parseTimesheetCell,
  planCellEdit,
  timesheetCellState,
  timesheetRowKey,
  timesheetWeekDays,
  type TimesheetCell,
  type TimesheetEntryInput,
} from "@starter/shared";

const HOUR = 3600;
const MINUTE = 60;
const BERLIN = "Europe/Berlin";

/** The instant a wall-clock reading names in Berlin, as an ISO string. */
const berlin = (
  day: string,
  hour: number,
  minute = 0,
): string => {
  // Berlin is UTC+1 in winter, UTC+2 in summer; both test dates are winter
  // unless the day says otherwise, so the offset is stated explicitly here
  // rather than derived — the point is to pin the instant, not to re-implement
  // the zone maths the code under test uses.
  const offset = day >= "2026-03-29" && day < "2026-10-25" ? 2 : 1;
  const utcHour = hour - offset;
  const stamp = new Date(`${day}T00:00:00Z`);
  stamp.setUTCHours(utcHour, minute, 0, 0);
  return stamp.toISOString();
};

const entry = (
  overrides: Partial<TimesheetEntryInput> & { start: string },
): TimesheetEntryInput => ({
  id: "e1",
  projectId: "p1",
  taskId: null,
  end: null,
  projectName: "Acme",
  projectColor: "#4f46e5",
  taskName: null,
  ...overrides,
});

const gridFor = (
  entries: TimesheetEntryInput[],
  days: string[],
  nowMs = Date.parse("2026-02-05T12:00:00Z"),
) =>
  buildTimesheetGrid({
    entries,
    days,
    timeZone: BERLIN,
    nowMs,
  });

const WEEK = timesheetWeekDays("2026-02-02");

describe("parseTimesheetCell", () => {
  it("reads a bare number as hours", () => {
    assert.equal(parseTimesheetCell("8"), 8 * HOUR);
    assert.equal(parseTimesheetCell("1.5"), 90 * MINUTE);
    assert.equal(parseTimesheetCell("1,5"), 90 * MINUTE);
    assert.equal(parseTimesheetCell(".5"), 30 * MINUTE);
  });

  it("agrees with every explicit spelling of ninety minutes", () => {
    for (const input of ["1.5", "1:30", "90m", "1h30m", "1h 30m", "1.5h"]) {
      assert.equal(
        parseTimesheetCell(input),
        90 * MINUTE,
        `"${input}" should be ninety minutes`,
      );
    }
  });

  it("round-trips both display formats", () => {
    assert.equal(parseTimesheetCell(formatTimesheetCell(5400, "hms")), 5400);
    assert.equal(
      parseTimesheetCell(formatTimesheetCell(5400, "decimal")),
      5400,
    );
  });

  it("treats an empty cell as zero, not as a parse failure", () => {
    assert.equal(parseTimesheetCell(""), 0);
    assert.equal(parseTimesheetCell("   "), 0);
    assert.equal(parseTimesheetCell("0"), 0);
  });

  it("rejects what is not a duration", () => {
    assert.equal(parseTimesheetCell("abc"), null);
    assert.equal(parseTimesheetCell("-1"), null);
    assert.equal(parseTimesheetCell("1x"), null);
  });

  it("renders zero as an empty cell", () => {
    assert.equal(formatTimesheetCell(0, "hms"), "");
    assert.equal(formatTimesheetCell(HOUR, "hms"), "1:00:00");
    assert.equal(formatTimesheetCell(5400, "decimal"), "1.50 h");
  });
});

describe("buildTimesheetGrid", () => {
  it("buckets an entry into the day it was tracked in", () => {
    const grid = gridFor(
      [
        entry({
          start: berlin("2026-02-03", 9),
          end: berlin("2026-02-03", 11),
        }),
      ],
      WEEK,
    );

    assert.equal(grid.rows.length, 1);
    const row = grid.rows[0];
    assert.ok(row);
    assert.equal(row.cells[1]?.seconds, 2 * HOUR);
    assert.equal(row.totalSec, 2 * HOUR);
    assert.equal(grid.dayTotals[1], 2 * HOUR);
    assert.equal(grid.totalSec, 2 * HOUR);
  });

  it("splits a midnight-crossing entry across exactly two cells", () => {
    const grid = gridFor(
      [
        entry({
          // 23:30 Tuesday to 00:30 Wednesday — one hour of real elapsed time.
          start: berlin("2026-02-03", 23, 30),
          end: berlin("2026-02-04", 0, 30),
        }),
      ],
      WEEK,
    );

    const row = grid.rows[0];
    assert.ok(row);
    assert.equal(row.cells[1]?.seconds, 30 * MINUTE);
    assert.equal(row.cells[2]?.seconds, 30 * MINUTE);
    // The week total is real elapsed time, never a double count.
    assert.equal(grid.totalSec, HOUR);
    assert.equal(row.totalSec, HOUR);
    // And each cell knows it holds only a slice, so neither is editable.
    assert.equal(timesheetCellState(row.cells[1] as TimesheetCell), "split");
    assert.equal(timesheetCellState(row.cells[2] as TimesheetCell), "split");
  });

  it("keeps day slices summing to the entry's own duration", () => {
    const grid = gridFor(
      [
        entry({
          start: berlin("2026-02-03", 22, 0),
          end: berlin("2026-02-04", 3, 0),
        }),
      ],
      WEEK,
    );

    const row = grid.rows[0];
    assert.ok(row);
    const slices = row.cells.reduce((total, cell) => total + cell.seconds, 0);
    assert.equal(slices, 5 * HOUR);
  });

  it("measures the running entry up to now", () => {
    const nowMs = Date.parse(berlin("2026-02-04", 12, 0));
    const grid = gridFor(
      [entry({ start: berlin("2026-02-04", 10, 0), end: null })],
      WEEK,
      nowMs,
    );

    const cell = grid.rows[0]?.cells[2];
    assert.ok(cell);
    assert.equal(cell.seconds, 2 * HOUR);
    assert.equal(timesheetCellState(cell), "running");
    assert.equal(isTimesheetCellEditable(cell), false);
  });

  it("groups by project and task, and shows pinned rows with no time", () => {
    const grid = buildTimesheetGrid({
      entries: [
        entry({
          id: "a",
          start: berlin("2026-02-03", 9),
          end: berlin("2026-02-03", 10),
        }),
        entry({
          id: "b",
          taskId: "t1",
          taskName: "Design",
          start: berlin("2026-02-03", 10),
          end: berlin("2026-02-03", 11),
        }),
      ],
      days: WEEK,
      timeZone: BERLIN,
      nowMs: Date.now(),
      seeds: [{ projectId: "p9", taskId: null, label: "Zulu", color: "#000000" }],
    });

    assert.equal(grid.rows.length, 3);
    const pinned = grid.rows.find((row) => row.projectId === "p9");
    assert.ok(pinned);
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.totalSec, 0);
    assert.equal(
      grid.rows.some(
        (row) => timesheetRowKey(row.projectId, row.taskId) === "p1::t1",
      ),
      true,
    );
  });

  it("sorts 'No project' last so the grid does not reshuffle while typing", () => {
    const grid = gridFor(
      [
        entry({
          id: "none",
          projectId: null,
          projectName: null,
          start: berlin("2026-02-03", 9),
          end: berlin("2026-02-03", 10),
        }),
        entry({
          id: "acme",
          start: berlin("2026-02-03", 10),
          end: berlin("2026-02-03", 11),
        }),
      ],
      WEEK,
    );

    assert.equal(grid.rows[0]?.label, "Acme");
    assert.equal(grid.rows[1]?.label, "No project");
  });

  it("keeps a zero-length entry in its cell", () => {
    const stamp = berlin("2026-02-03", 9);
    const grid = gridFor([entry({ start: stamp, end: stamp })], WEEK);

    const cell = grid.rows[0]?.cells[1];
    assert.ok(cell);
    assert.equal(cell.seconds, 0);
    // It exists, so the cell is "single" — editing it must adjust that entry
    // rather than create a second one beside it.
    assert.equal(timesheetCellState(cell), "single");
  });
});

// ── cell edit resolution ─────────────────────────────────────────────

const cellWith = (
  day: string,
  entries: TimesheetCell["entries"],
): TimesheetCell => ({
  day,
  seconds: entries.reduce((total, item) => total + item.secondsInCell, 0),
  entries,
});

const cellEntry = (
  overrides: Partial<TimesheetCell["entries"][number]> = {},
): TimesheetCell["entries"][number] => ({
  id: "e1",
  start: berlin("2026-02-03", 9),
  end: berlin("2026-02-03", 10),
  secondsInCell: HOUR,
  containedInDay: true,
  running: false,
  ...overrides,
});

describe("planCellEdit", () => {
  it("creates one entry for an empty cell", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", []),
      timeZone: BERLIN,
      targetSeconds: 3 * HOUR,
    });

    assert.equal(plan.kind, "create");
    assert.ok(plan.kind === "create");
    // 09:00 local, per the documented convention.
    assert.equal(dayKeyInZone(Date.parse(plan.start), BERLIN), "2026-02-03");
    assert.equal(plan.start, berlin("2026-02-03", 9));
    assert.equal(plan.end, berlin("2026-02-03", 12));
  });

  it("anchors a long cell to the end of the day so it cannot spill over", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", []),
      timeZone: BERLIN,
      targetSeconds: 20 * HOUR,
    });

    assert.ok(plan.kind === "create");
    // 20h ending at midnight starts at 04:00, still inside the typed day.
    assert.equal(dayKeyInZone(Date.parse(plan.start), BERLIN), "2026-02-03");
    assert.equal(plan.end, berlin("2026-02-04", 0));
  });

  it("does nothing when an empty cell is cleared or unchanged", () => {
    assert.equal(
      planCellEdit({
        cell: cellWith("2026-02-03", []),
        timeZone: BERLIN,
        targetSeconds: 0,
      }).kind,
      "noop",
    );
    assert.equal(
      planCellEdit({
        cell: cellWith("2026-02-03", [cellEntry()]),
        timeZone: BERLIN,
        targetSeconds: HOUR,
      }).kind,
      "noop",
    );
  });

  it("moves the END of a single entry, never its start", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [cellEntry()]),
      timeZone: BERLIN,
      targetSeconds: 3 * HOUR,
    });

    assert.ok(plan.kind === "adjust");
    assert.equal(plan.id, "e1");
    assert.equal(plan.end, berlin("2026-02-03", 12));
  });

  it("deletes the single entry when the cell is cleared", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [cellEntry()]),
      timeZone: BERLIN,
      targetSeconds: 0,
    });

    assert.deepEqual(plan, { kind: "delete", id: "e1" });
  });

  it("refuses to lengthen a single entry past midnight", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [
        cellEntry({ start: berlin("2026-02-03", 22), secondsInCell: HOUR }),
      ]),
      timeZone: BERLIN,
      targetSeconds: 5 * HOUR,
    });

    assert.deepEqual(plan, { kind: "refuse", reason: "too-long" });
  });

  it("refuses a cell holding several entries rather than picking one", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [
        cellEntry({ id: "a" }),
        cellEntry({ id: "b", secondsInCell: 2 * HOUR }),
      ]),
      timeZone: BERLIN,
      targetSeconds: 5 * HOUR,
    });

    assert.deepEqual(plan, { kind: "refuse", reason: "multiple" });
  });

  it("refuses a cell whose entry crosses midnight", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [cellEntry({ containedInDay: false })]),
      timeZone: BERLIN,
      targetSeconds: 5 * HOUR,
    });

    assert.deepEqual(plan, { kind: "refuse", reason: "spans-days" });
  });

  it("never clobbers the running entry", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", [cellEntry({ end: null, running: true })]),
      timeZone: BERLIN,
      targetSeconds: 5 * HOUR,
    });

    assert.deepEqual(plan, { kind: "refuse", reason: "running" });
  });

  it("refuses more time than a day holds", () => {
    const plan = planCellEdit({
      cell: cellWith("2026-02-03", []),
      timeZone: BERLIN,
      targetSeconds: 25 * HOUR,
    });

    assert.deepEqual(plan, { kind: "refuse", reason: "too-long" });
  });

  it("measures the limit in real elapsed time across a DST shift", () => {
    // 29 March 2026 is 23 hours long in Berlin — 02:00 never happens.
    const plan = planCellEdit({
      cell: cellWith("2026-03-29", []),
      timeZone: BERLIN,
      targetSeconds: 24 * HOUR,
    });
    assert.deepEqual(plan, { kind: "refuse", reason: "too-long" });

    const fits = planCellEdit({
      cell: cellWith("2026-03-29", []),
      timeZone: BERLIN,
      targetSeconds: 23 * HOUR,
    });
    assert.equal(fits.kind, "create");
  });

  it("puts a created entry inside the typed day in a zone that skips midnight", () => {
    // America/Santiago springs forward AT midnight, so 00:00 does not exist on
    // that date. 09:00 does, which is why the convention is not midnight.
    const santiago = "America/Santiago";
    const start = cellStartMs("2026-09-06", santiago, 2 * HOUR);
    assert.equal(dayKeyInZone(start, santiago), "2026-09-06");
  });
});
