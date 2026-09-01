/**
 * Live elapsed seconds for the running entry, computed in the popup.
 *
 * The service worker cannot be the clock here: MV3 suspends it after ~30s of
 * idle, so a worker-pushed tick would freeze mid-count while the popup is
 * still open and visibly running. The popup instead derives elapsed from
 * `running.start` against the wall clock — the same rule core's timer store
 * already enforces, which is why the store is reused rather than a counter
 * kept here.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  createTimerStore,
  startTicking,
  type TimeEntry,
  type TimerStore,
} from "@starter/core";

export function useElapsedSec(running: TimeEntry | null): number {
  // Lazy initialiser: one store for the popup's lifetime, not one per render.
  const [store] = useState<TimerStore>(() => createTimerStore());

  // Adopt whatever entry the latest BackgroundState carries, including a
  // start that happened on another device while the popup was shut.
  useEffect(() => {
    store.getState().setRunning(running);
  }, [running, store]);

  // startTicking returns its own stopper, so the interval dies with the popup
  // instead of leaking into the next open.
  useEffect(() => startTicking(store), [store]);

  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().elapsedSec,
  );
}
