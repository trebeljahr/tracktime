/**
 * Tests for the entry editor's save rules.
 *
 * These are pure functions on purpose — they used to live inside the edit
 * dialog, where the only way to reach them was through a DOM, and they are the
 * rules that lose a user's data when they are wrong: re-anchoring a date in the
 * wrong zone moves an entry by hours, and clamping a midnight-crossing end
 * deletes an hour of work.
 *
 * Every assertion here is written in Europe/Berlin wall-clock terms rather than
 * the host's local time, so the suite says the same thing on a laptop in Berlin
 * and on CI in UTC.
 */
import { describe, expect, it } from "vitest";
import { zonedWallClockToMs } from "@starter/shared";
import {
  editorDurationSeconds,
  endForDurationSeconds,
  entryUpdateFrom,
  movedEndDay,
  movedStartDay,
} from "./use-entry-editor";

const BERLIN = "Europe/Berlin";

/** The instant a Berlin wall clock reads this. */
const berlin = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): string =>
  new Date(
    zonedWallClockToMs({ year, month, day, hour, minute, second: 0 }, BERLIN)
  ).toISOString();

/** What a Berlin wall clock reads at this instant, "YYYY-MM-DD HH:MM". */
const berlinClock = (iso: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
};

const seconds = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 1000);

describe("movedStartDay", () => {
  it("re-anchors in the entry's zone, not the editor's", () => {
    // 23:30-00:30 Berlin, i.e. 22:30-23:30 UTC on the 20th. Moving it to the
    // 25th must land on the 25th IN BERLIN at 23:30 — doing the arithmetic in
    // UTC would leave it at 22:30 UTC on the 25th, which is 23:30 Berlin on
    // the 25th only by luck of the offset, and is a whole day out whenever
    // the editor's zone is far enough away.
    const times = {
      start: berlin(2026, 8, 20, 23, 30),
      end: berlin(2026, 8, 21, 0, 30),
    };

    const moved = movedStartDay(times, "2026-08-25", BERLIN);

    expect(berlinClock(moved.start)).toBe("2026-08-25 23:30");
    // The end came along, so the entry is still an hour and still crosses
    // midnight into the 26th.
    expect(berlinClock(moved.end)).toBe("2026-08-26 00:30");
    expect(seconds(moved.start, moved.end)).toBe(3600);
  });

  it("keeps a Tokyo-recorded entry on Tokyo's clock", () => {
    // The mirror image: the rule is "the entry's zone", not "Berlin".
    const tokyo = "Asia/Tokyo";
    const start = new Date(
      zonedWallClockToMs(
        { year: 2026, month: 8, day: 20, hour: 23, minute: 30, second: 0 },
        tokyo
      )
    ).toISOString();
    const times = { start, end: new Date(Date.parse(start) + 3600_000).toISOString() };

    const moved = movedStartDay(times, "2026-08-25", tokyo);

    const clock = new Intl.DateTimeFormat("en-CA", {
      timeZone: tokyo,
      hour12: false,
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(moved.start));
    expect(clock).toContain("23:30");
    expect(clock).toContain("2026-08-25");
  });

  it("carries the end by the same delta so the duration is unchanged", () => {
    const times = {
      start: berlin(2026, 8, 20, 9, 0),
      end: berlin(2026, 8, 20, 17, 30),
    };

    const moved = movedStartDay(times, "2026-09-03", BERLIN);

    expect(berlinClock(moved.start)).toBe("2026-09-03 09:00");
    expect(berlinClock(moved.end)).toBe("2026-09-03 17:30");
    expect(seconds(moved.start, moved.end)).toBe(seconds(times.start, times.end));
  });
});

describe("movedStartDay across a DST transition", () => {
  // 2026-03-29 is Berlin's spring forward: 02:00 becomes 03:00, so no clock
  // in Berlin reads 02:30 that day. 2026-10-25 is the fall back: 02:30
  // happens twice. A phone edits dates with a native picker, so landing an
  // entry on one of these two days is an ordinary action, not a corner case.

  it("shifts a start onto the first instant that exists when the hour is skipped", () => {
    const times = {
      start: berlin(2026, 3, 15, 2, 30),
      end: berlin(2026, 3, 15, 4, 30),
    };

    const moved = movedStartDay(times, "2026-03-29", BERLIN);

    // Decided behaviour: shift forward, do not refuse. The entry lands on the
    // day the user picked at the first clock reading that day actually has,
    // which is one gap-width later. Refusing would leave the picker showing a
    // date the entry is not on, which is worse than a documented hour.
    expect(berlinClock(moved.start)).toBe("2026-03-29 03:30");
    expect(moved.start).toBe("2026-03-29T01:30:00.000Z");
  });

  it("keeps the elapsed time exact when the start lands on a spring-forward day", () => {
    // The end moves by the same millisecond delta rather than being
    // re-anchored itself, which is what stops the missing hour from being
    // added to or taken off the entry.
    const times = {
      start: berlin(2026, 3, 15, 2, 30),
      end: berlin(2026, 3, 15, 4, 30),
    };

    const moved = movedStartDay(times, "2026-03-29", BERLIN);

    expect(seconds(moved.start, moved.end)).toBe(2 * 3600);
    expect(seconds(times.start, times.end)).toBe(2 * 3600);
    // The wall clock therefore reads two hours later on a day that has an
    // hour missing between them — 03:30 to 05:30, not 03:30 to 04:30.
    expect(berlinClock(moved.end)).toBe("2026-03-29 05:30");
  });

  it("resolves an ambiguous fall-back hour to a single defined instant", () => {
    const times = {
      start: berlin(2026, 3, 15, 2, 30),
      end: berlin(2026, 3, 15, 3, 30),
    };

    const moved = movedStartDay(times, "2026-10-25", BERLIN);

    // 02:30 exists twice on 2026-10-25: once at +02:00 (00:30Z) and again at
    // +01:00 (01:30Z). Pinned to the second, which is what the two-pass
    // resolution in `zonedWallClockToMs` produces. What matters is that it is
    // deterministic and that the clock still reads what the user typed.
    expect(berlinClock(moved.start)).toBe("2026-10-25 02:30");
    expect(moved.start).toBe("2026-10-25T01:30:00.000Z");
    expect(seconds(moved.start, moved.end)).toBe(3600);
  });
});

describe("movedEndDay", () => {
  it("moves only the end, keeping its clock time in the entry's zone", () => {
    const times = {
      start: berlin(2026, 8, 20, 23, 30),
      end: berlin(2026, 8, 21, 0, 30),
    };

    const moved = movedEndDay(times, "2026-08-22", BERLIN);

    expect(moved.start).toBe(times.start);
    expect(berlinClock(moved.end)).toBe("2026-08-22 00:30");
  });
});

describe("editorDurationSeconds", () => {
  it("counts the whole seconds between the two instants", () => {
    expect(
      editorDurationSeconds({
        start: berlin(2026, 8, 20, 9, 0),
        end: berlin(2026, 8, 20, 10, 30),
      })
    ).toBe(5400);
  });

  it("never reports a negative duration", () => {
    expect(
      editorDurationSeconds({
        start: berlin(2026, 8, 20, 10, 0),
        end: berlin(2026, 8, 20, 9, 0),
      })
    ).toBe(0);
  });
});

describe("endForDurationSeconds", () => {
  it("puts the end that many seconds after the start", () => {
    const start = berlin(2026, 8, 20, 9, 0);
    expect(endForDurationSeconds(start, 5400)).toBe(berlin(2026, 8, 20, 10, 30));
  });

  it("floors at one minute, so an entry can never be zero-length", () => {
    const start = berlin(2026, 8, 20, 9, 0);
    expect(endForDurationSeconds(start, 0)).toBe(berlin(2026, 8, 20, 9, 1));
    expect(endForDurationSeconds(start, -600)).toBe(berlin(2026, 8, 20, 9, 1));
  });
});

describe("entryUpdateFrom", () => {
  const fields = {
    description: "Wrote tests",
    projectId: "p1",
    taskId: null,
    billable: true,
    tagIds: ["t1"],
  };

  it("rolls a midnight-crossing end forward instead of clamping it", () => {
    // The user typed 23:30 to 00:30. Clamping to start + 1 minute used to
    // destroy the hour they had just recorded.
    const times = {
      start: berlin(2026, 8, 20, 23, 30),
      end: berlin(2026, 8, 20, 0, 30),
    };

    const update = entryUpdateFrom({ id: "e1", end: times.end }, fields, times);

    expect(update.end).toBe(berlin(2026, 8, 21, 0, 30));
    expect(seconds(update.start as string, update.end as string)).toBe(3600);
  });

  it("leaves an end that is already after the start alone", () => {
    const times = {
      start: berlin(2026, 8, 20, 9, 0),
      end: berlin(2026, 8, 20, 17, 0),
    };

    const update = entryUpdateFrom({ id: "e1", end: times.end }, fields, times);

    expect(update.end).toBe(times.end);
  });

  it("keeps a running entry running", () => {
    // The end buffer holds "now" while a timer runs, and the editor's own end
    // field is disabled. Saving a description must not close the entry — even
    // when the buffered end would otherwise have been rolled forward.
    const times = {
      start: berlin(2026, 8, 20, 23, 30),
      end: berlin(2026, 8, 20, 0, 30),
    };

    const update = entryUpdateFrom({ id: "e1", end: null }, fields, times);

    expect(update.end).toBeNull();
    expect(update.start).toBe(times.start);
  });

  it("carries the five entry fields and the id through untouched", () => {
    const times = {
      start: berlin(2026, 8, 20, 9, 0),
      end: berlin(2026, 8, 20, 10, 0),
    };

    const update = entryUpdateFrom({ id: "e9", end: times.end }, fields, times);

    expect(update).toEqual({
      id: "e9",
      description: "Wrote tests",
      projectId: "p1",
      taskId: null,
      billable: true,
      tagIds: ["t1"],
      start: times.start,
      end: times.end,
    });
  });
});
