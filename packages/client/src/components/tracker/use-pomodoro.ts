"use client";

import * as React from "react";
import {
  createPomodoro,
  type PomodoroPhase,
  type PomodoroSettings,
  type PomodoroSnapshot,
  type PomodoroTransition,
} from "@starter/core";

const IDLE: PomodoroSnapshot = {
  phase: "idle",
  cycle: 0,
  remainingSec: 0,
  running: false,
};

export const POMODORO_PHASE_LABELS: Record<PomodoroPhase, string> = {
  idle: "Pomodoro",
  work: "Focus",
  break: "Break",
  longBreak: "Long break",
};

const notificationsSupported = (): boolean =>
  typeof window !== "undefined" && "Notification" in window;

/**
 * Ask for notification permission. Must be called from a user gesture —
 * browsers reject (and Safari permanently denies) a prompt fired on mount.
 *
 * Only asks when the pomodoro feature is switched on AND set to notify.
 * Both are off by default, so someone who just wants a stopwatch is never
 * prompted; asking anyway trains people to hit "Block", which then breaks
 * notifications for the users who do want them.
 */
export const requestPomodoroPermission = (config?: PomodoroSettings): void => {
  if (!config?.enabled || !config.notify) return;
  if (!notificationsSupported()) return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
};

const phaseNotification = (
  transition: PomodoroTransition
): { title: string; body: string } => {
  switch (transition.to) {
    case "break":
      return {
        title: "Time for a break",
        body: `Pomodoro ${transition.cycle} done — your timer keeps running.`,
      };
    case "longBreak":
      return {
        title: "Time for a long break",
        body: `${transition.cycle} pomodoros done — your timer keeps running.`,
      };
    case "work":
      return {
        title: "Back to focus",
        body: "Break over — next pomodoro started.",
      };
    case "idle":
      return { title: "Pomodoro stopped", body: "" };
  }
};

const notifyPhase = (transition: PomodoroTransition): void => {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  const { title, body } = phaseNotification(transition);
  try {
    new Notification(title, { body, tag: "tracktime-pomodoro" });
  } catch {
    // Some engines only allow notifications from a service worker. The
    // in-app indicator is the fallback and is always present.
  }
};

export type PomodoroState = {
  /** True when pomodoro is switched on in settings and the timer is running. */
  active: boolean;
  phase: PomodoroPhase;
  label: string;
  remainingSec: number;
  /** Completed work intervals in the current set. */
  cycle: number;
};

type SnapshotStore = {
  snapshot: PomodoroSnapshot;
  listeners: Set<() => void>;
};

/**
 * Runs the framework-free pomodoro machine from `@starter/core` on the same
 * once-a-second cadence as the running timer.
 *
 * The machine is an external system rather than React state, so a tick never
 * cascades a render through the entry list beneath it.
 *
 * It never touches the user's timer — a phase change only notifies. Auto-
 * stopping someone's tracking because a 25-minute box elapsed would lose real
 * work, which is exactly the failure a time tracker must not have.
 */
export const usePomodoro = ({
  config,
  running,
}: {
  config: PomodoroSettings;
  running: boolean;
}): PomodoroState => {
  const storeRef = React.useRef<SnapshotStore>({
    snapshot: IDLE,
    listeners: new Set(),
  });

  const subscribe = React.useCallback((listener: () => void): (() => void) => {
    const store = storeRef.current;
    store.listeners.add(listener);
    return () => {
      store.listeners.delete(listener);
    };
  }, []);

  const getSnapshot = React.useCallback(
    (): PomodoroSnapshot => storeRef.current.snapshot,
    []
  );
  const getServerSnapshot = React.useCallback((): PomodoroSnapshot => IDLE, []);

  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const active = config.enabled && running;

  // Restart when the box lengths change, not on every settings object
  // identity — the settings query hands back a fresh object on each refetch.
  const shape = `${config.workMinutes}|${config.breakMinutes}|${config.longBreakMinutes}|${config.cyclesBeforeLongBreak}`;
  const notify = config.notify;

  React.useEffect(() => {
    const store = storeRef.current;
    const emit = (next: PomodoroSnapshot): void => {
      store.snapshot = next;
      for (const listener of store.listeners) listener();
    };

    if (!active) {
      emit(IDLE);
      return;
    }

    const machine = createPomodoro(config);
    emit(machine.start(Date.now()));

    const handle = setInterval(() => {
      const transition = machine.tick(Date.now());
      if (transition !== null && notify) notifyPhase(transition);
      emit(machine.snapshot());
    }, 1000);

    return () => {
      clearInterval(handle);
    };
    // `config` is deliberately absent — `shape` is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shape, notify]);

  return {
    active,
    phase: snapshot.phase,
    label: POMODORO_PHASE_LABELS[snapshot.phase],
    remainingSec: Math.max(0, snapshot.remainingSec),
    cycle: snapshot.cycle,
  };
};
