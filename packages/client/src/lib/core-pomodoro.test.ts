/**
 * Unit tests for the pure pomodoro state machine in @starter/core. It owns no
 * timer of its own — the caller drives it with `tick(now)` — so every cycle
 * transition can be asserted deterministically.
 */
import { describe, expect, it } from "vitest";
import {
  createPomodoro,
  type Pomodoro,
  type PomodoroSettings,
  type PomodoroTransition,
} from "@starter/core";

const SETTINGS: PomodoroSettings = {
  enabled: true,
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  notify: true,
};

const WORK_SEC = 25 * 60;
const BREAK_SEC = 5 * 60;
const LONG_BREAK_SEC = 15 * 60;

/** Tick the machine forward far enough to end the current phase. */
const finishPhase = (
  pomodoro: Pomodoro,
  atMs: number,
  seconds: number
): { transition: PomodoroTransition | null; nowMs: number } => {
  const nowMs = atMs + seconds * 1000;
  return { transition: pomodoro.tick(nowMs), nowMs };
};

describe("createPomodoro", () => {
  it("is idle until it is started", () => {
    const pomodoro = createPomodoro(SETTINGS);
    expect(pomodoro.snapshot()).toEqual({
      phase: "idle",
      cycle: 0,
      remainingSec: 0,
      running: false,
    });
    expect(pomodoro.tick(60_000)).toBeNull();
  });

  it("starts a work interval", () => {
    const pomodoro = createPomodoro(SETTINGS);
    expect(pomodoro.start(0)).toEqual({
      phase: "work",
      cycle: 0,
      remainingSec: WORK_SEC,
      running: true,
    });
  });

  it("counts down without transitioning mid-phase", () => {
    const pomodoro = createPomodoro(SETTINGS);
    pomodoro.start(0);

    expect(pomodoro.tick(60_000)).toBeNull();
    expect(pomodoro.snapshot().remainingSec).toBe(WORK_SEC - 60);

    // A tick with no elapsed whole second changes nothing.
    expect(pomodoro.tick(60_500)).toBeNull();
    expect(pomodoro.snapshot().remainingSec).toBe(WORK_SEC - 60);
  });

  it("runs work → break → work and counts completed work intervals", () => {
    const pomodoro = createPomodoro(SETTINGS);
    pomodoro.start(0);

    const first = finishPhase(pomodoro, 0, WORK_SEC);
    expect(first.transition).toEqual({ from: "work", to: "break", cycle: 1 });
    expect(pomodoro.snapshot()).toEqual({
      phase: "break",
      cycle: 1,
      remainingSec: BREAK_SEC,
      running: true,
    });

    const second = finishPhase(pomodoro, first.nowMs, BREAK_SEC);
    expect(second.transition).toEqual({ from: "break", to: "work", cycle: 1 });
    expect(pomodoro.snapshot()).toEqual({
      phase: "work",
      cycle: 1,
      remainingSec: WORK_SEC,
      running: true,
    });
  });

  it("takes a long break after the configured number of work intervals", () => {
    const pomodoro = createPomodoro(SETTINGS);
    pomodoro.start(0);

    const transitions: PomodoroTransition[] = [];
    let nowMs = 0;

    // Four work intervals, each followed by whatever break it earns.
    for (let index = 0; index < 4; index += 1) {
      const work = finishPhase(pomodoro, nowMs, WORK_SEC);
      nowMs = work.nowMs;
      expect(work.transition).not.toBeNull();
      transitions.push(work.transition as PomodoroTransition);

      const isLast = index === 3;
      const rest = finishPhase(
        pomodoro,
        nowMs,
        isLast ? LONG_BREAK_SEC : BREAK_SEC
      );
      nowMs = rest.nowMs;
      transitions.push(rest.transition as PomodoroTransition);
    }

    expect(transitions.map((transition) => transition.to)).toEqual([
      "break",
      "work",
      "break",
      "work",
      "break",
      "work",
      "longBreak",
      "work",
    ]);
    expect(transitions.map((transition) => transition.cycle)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it("gives the long break its own length", () => {
    const pomodoro = createPomodoro({ ...SETTINGS, cyclesBeforeLongBreak: 1 });
    pomodoro.start(0);

    const work = finishPhase(pomodoro, 0, WORK_SEC);
    expect(work.transition?.to).toBe("longBreak");
    expect(pomodoro.snapshot().remainingSec).toBe(LONG_BREAK_SEC);
  });

  it("does not lose the phase length to a late tick", () => {
    const pomodoro = createPomodoro(SETTINGS);
    pomodoro.start(0);

    // The tab was asleep — one tick arrives long after the work phase ended.
    const transition = pomodoro.tick((WORK_SEC + 90) * 1000);
    expect(transition).toEqual({ from: "work", to: "break", cycle: 1 });
    expect(pomodoro.snapshot().remainingSec).toBe(BREAK_SEC);
  });

  describe("pause / resume", () => {
    it("freezes the countdown while paused", () => {
      const pomodoro = createPomodoro(SETTINGS);
      pomodoro.start(0);
      pomodoro.tick(600_000); // 10 minutes of work
      expect(pomodoro.snapshot().remainingSec).toBe(WORK_SEC - 600);

      const paused = pomodoro.pause(600_000);
      expect(paused.running).toBe(false);
      expect(paused.phase).toBe("work");

      // Ten minutes pass while paused — nothing is consumed.
      expect(pomodoro.tick(1_200_000)).toBeNull();
      expect(pomodoro.snapshot().remainingSec).toBe(WORK_SEC - 600);
    });

    it("resumes where it left off, not where the clock is", () => {
      const pomodoro = createPomodoro(SETTINGS);
      pomodoro.start(0);
      pomodoro.tick(600_000);
      pomodoro.pause(600_000);
      pomodoro.tick(1_200_000);

      const resumed = pomodoro.resume(1_200_000);
      expect(resumed.running).toBe(true);
      expect(resumed.remainingSec).toBe(WORK_SEC - 600);

      pomodoro.tick(1_500_000); // five more minutes
      expect(pomodoro.snapshot().remainingSec).toBe(WORK_SEC - 900);
    });

    it("resuming from idle starts a work interval", () => {
      const pomodoro = createPomodoro(SETTINGS);
      expect(pomodoro.resume(0)).toEqual({
        phase: "work",
        cycle: 0,
        remainingSec: WORK_SEC,
        running: true,
      });
    });
  });

  describe("skip / reset", () => {
    it("skip jumps straight to the next phase", () => {
      const pomodoro = createPomodoro(SETTINGS);
      pomodoro.start(0);

      expect(pomodoro.skip(60_000)).toEqual({
        phase: "break",
        cycle: 1,
        remainingSec: BREAK_SEC,
        running: true,
      });
      expect(pomodoro.skip(120_000).phase).toBe("work");
    });

    it("skip from idle starts working", () => {
      const pomodoro = createPomodoro(SETTINGS);
      expect(pomodoro.skip(0).phase).toBe("work");
    });

    it("reset returns to idle and forgets the cycle count", () => {
      const pomodoro = createPomodoro(SETTINGS);
      pomodoro.start(0);
      pomodoro.skip(0);

      expect(pomodoro.reset()).toEqual({
        phase: "idle",
        cycle: 0,
        remainingSec: 0,
        running: false,
      });
      expect(pomodoro.tick(999_000)).toBeNull();
    });

    it("start over resets the cycle count", () => {
      const pomodoro = createPomodoro(SETTINGS);
      pomodoro.start(0);
      pomodoro.skip(0);
      expect(pomodoro.snapshot().cycle).toBe(1);

      expect(pomodoro.start(0).cycle).toBe(0);
    });
  });

  it("clamps nonsense configuration to at least one second per phase", () => {
    const pomodoro = createPomodoro({
      ...SETTINGS,
      workMinutes: 0,
      breakMinutes: -5,
      cyclesBeforeLongBreak: 0,
    });

    expect(pomodoro.start(0).remainingSec).toBe(1);
    // cyclesBeforeLongBreak clamped to 1, so the first break is a long one.
    expect(pomodoro.tick(1_000)?.to).toBe("longBreak");
  });
});
