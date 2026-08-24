import { createStore, type StoreApi } from "zustand/vanilla";
import { entryDurationSec, type TimeEntry } from "@starter/shared";

export type TimerState = {
  /** The entry currently running, or null when the timer is stopped. */
  running: TimeEntry | null;
  /** Seconds elapsed on `running`. Always derived, never accumulated. */
  elapsedSec: number;
  setRunning: (entry: TimeEntry | null) => void;
  clear: () => void;
  tick: (nowMs?: number) => void;
};

export type TimerStore = StoreApi<TimerState>;

const elapsedFor = (entry: TimeEntry | null, nowMs: number): number =>
  entry ? entryDurationSec(entry, nowMs) : 0;

/**
 * Holds the running timer and its live elapsed seconds.
 *
 * `elapsedSec` is recomputed from `entry.start` against the wall clock on
 * every tick rather than incremented, so it stays correct across laptop
 * sleep, backgrounded tabs and throttled timers — the cases where a
 * naive counter silently drifts.
 */
export const createTimerStore = (): TimerStore =>
  createStore<TimerState>((set, get) => ({
    running: null,
    elapsedSec: 0,
    setRunning: (entry) =>
      set({ running: entry, elapsedSec: elapsedFor(entry, Date.now()) }),
    clear: () => set({ running: null, elapsedSec: 0 }),
    tick: (nowMs = Date.now()) => {
      const { running, elapsedSec } = get();
      const next = elapsedFor(running, nowMs);
      if (next !== elapsedSec) set({ elapsedSec: next });
    },
  }));

/**
 * Drive `store.tick()` once a second. Returns a stopper.
 *
 * `intervalMs` is configurable so tests can run it fast; `setIntervalImpl`
 * lets non-DOM hosts inject their own scheduler.
 */
export const startTicking = (
  store: TimerStore,
  options: {
    intervalMs?: number;
    setIntervalImpl?: typeof setInterval;
    clearIntervalImpl?: typeof clearInterval;
  } = {}
): (() => void) => {
  const {
    intervalMs = 1000,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = options;

  store.getState().tick();
  const handle = setIntervalImpl(() => store.getState().tick(), intervalMs);
  return () => clearIntervalImpl(handle);
};
