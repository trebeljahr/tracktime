/**
 * A device clock that is behind the running entry's start.
 *
 * `entryDurationSec` clamps elapsed time with `Math.max(0, …)`, so a phone
 * whose clock has been set by hand — or has come back from a dead battery
 * before NTP catches up — shows a timer frozen at 0:00 while the entry
 * genuinely runs. The clamp is the right call (a counting-down clock is
 * worse), but the result is unexplainable from the outside, so it is named.
 */
import { describe, expect, it } from "vitest";
import type { TimeEntry } from "@starter/shared";

import { clockLooksWrong } from "@/hooks/use-sync";

const START = "2026-08-21T09:00:00.000Z";
const startMs = Date.parse(START);

const entry = (overrides: Partial<TimeEntry> = {}): TimeEntry =>
  ({
    id: "e1",
    workspaceId: "w1",
    authorId: "u1",
    description: "",
    projectId: null,
    taskId: null,
    billable: false,
    start: START,
    end: null,
    durationSec: 0,
    hourlyRate: null,
    currency: "EUR",
    ...overrides,
  }) as TimeEntry;

describe("clockLooksWrong", () => {
  it("is quiet when the clock is ahead of the start, as it should be", () => {
    expect(clockLooksWrong(entry(), startMs + 1000)).toBe(false);
  });

  it("tolerates a minute of drift between two honest clocks", () => {
    // The start may have been stamped by the server or by another device.
    expect(clockLooksWrong(entry(), startMs - 30_000)).toBe(false);
  });

  it("fires once the device is properly behind", () => {
    expect(clockLooksWrong(entry(), startMs - 10 * 60_000)).toBe(true);
  });

  it("says nothing about a stopped entry or no entry at all", () => {
    expect(clockLooksWrong(null, startMs - 10 * 60_000)).toBe(false);
    expect(
      clockLooksWrong(
        entry({ end: "2026-08-21T10:00:00.000Z" }),
        startMs - 10 * 60_000,
      ),
    ).toBe(false);
  });

  it("does not fire on an unparseable start", () => {
    expect(clockLooksWrong(entry({ start: "nonsense" }), 0)).toBe(false);
  });
});
