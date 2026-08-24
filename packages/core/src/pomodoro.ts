import type { PomodoroSettings } from "@starter/shared";

export type PomodoroPhase = "idle" | "work" | "break" | "longBreak";

export type PomodoroSnapshot = {
  phase: PomodoroPhase;
  /** Completed work intervals in the current set. */
  cycle: number;
  remainingSec: number;
  running: boolean;
};

export type PomodoroTransition = {
  from: PomodoroPhase;
  to: PomodoroPhase;
  cycle: number;
};

export type Pomodoro = {
  start(nowMs?: number): PomodoroSnapshot;
  pause(nowMs?: number): PomodoroSnapshot;
  resume(nowMs?: number): PomodoroSnapshot;
  reset(): PomodoroSnapshot;
  /** Advance to the next phase immediately. */
  skip(nowMs?: number): PomodoroSnapshot;
  /** Drive the clock. Returns the transition, if this tick caused one. */
  tick(nowMs: number): PomodoroTransition | null;
  snapshot(nowMs?: number): PomodoroSnapshot;
};

const phaseSeconds = (
  phase: PomodoroPhase,
  config: PomodoroSettings
): number => {
  switch (phase) {
    case "work":
      return Math.max(1, Math.round(config.workMinutes * 60));
    case "break":
      return Math.max(1, Math.round(config.breakMinutes * 60));
    case "longBreak":
      return Math.max(1, Math.round(config.longBreakMinutes * 60));
    case "idle":
      return 0;
  }
};

/**
 * Pure pomodoro state machine — no timers inside. The caller drives it with
 * `tick(now)`, which keeps it testable and lets the UI reuse the same
 * once-a-second tick that already drives the running timer.
 */
export const createPomodoro = (config: PomodoroSettings): Pomodoro => {
  let phase: PomodoroPhase = "idle";
  let cycle = 0;
  let running = false;
  let remainingSec = 0;
  let lastTickMs: number | null = null;

  const cyclesBeforeLongBreak = Math.max(1, config.cyclesBeforeLongBreak);

  const enter = (next: PomodoroPhase, nowMs: number): void => {
    phase = next;
    remainingSec = phaseSeconds(next, config);
    lastTickMs = nowMs;
    running = next !== "idle";
  };

  const nextPhase = (): PomodoroPhase => {
    if (phase !== "work") return "work";
    return cycle % cyclesBeforeLongBreak === 0 ? "longBreak" : "break";
  };

  const advance = (nowMs: number): PomodoroTransition => {
    const from = phase;
    if (from === "work") cycle += 1;
    const to = nextPhase();
    enter(to, nowMs);
    return { from, to, cycle };
  };

  const snapshot = (): PomodoroSnapshot => ({
    phase,
    cycle,
    remainingSec,
    running,
  });

  return {
    start: (nowMs = Date.now()) => {
      cycle = 0;
      enter("work", nowMs);
      return snapshot();
    },

    pause: (nowMs = Date.now()) => {
      lastTickMs = nowMs;
      running = false;
      return snapshot();
    },

    resume: (nowMs = Date.now()) => {
      if (phase === "idle") {
        enter("work", nowMs);
        return snapshot();
      }
      lastTickMs = nowMs;
      running = true;
      return snapshot();
    },

    reset: () => {
      phase = "idle";
      cycle = 0;
      running = false;
      remainingSec = 0;
      lastTickMs = null;
      return snapshot();
    },

    skip: (nowMs = Date.now()) => {
      if (phase === "idle") {
        enter("work", nowMs);
        return snapshot();
      }
      advance(nowMs);
      return snapshot();
    },

    tick: (nowMs) => {
      if (!running || phase === "idle") {
        lastTickMs = nowMs;
        return null;
      }

      const elapsedSec =
        lastTickMs === null ? 0 : Math.floor((nowMs - lastTickMs) / 1000);
      if (elapsedSec <= 0) return null;

      lastTickMs = nowMs;
      remainingSec -= elapsedSec;
      if (remainingSec > 0) return null;

      return advance(nowMs);
    },

    snapshot: () => snapshot(),
  };
};
