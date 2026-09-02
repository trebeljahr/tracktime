/**
 * The idle-detection policy: defaults, the per-project override rule, and the
 * labels every client renders it with.
 *
 * The *decision machine* lives in `@starter/core/idle`; only the values that
 * the server, the web client and the extensions all have to agree on are here,
 * because the server package imports `@starter/shared` and not `@starter/core`.
 */

import type { IdleBehavior, IdleSettings } from "./types.js";

/** Every behaviour, in the order the settings UI offers them. */
export const IDLE_BEHAVIORS: readonly IdleBehavior[] = [
  "ask",
  "pause-and-resume",
  "keep-running",
  "stop",
];

/**
 * Off by default, and `ask` when it is switched on.
 *
 * Both halves are deliberate. Detection that silently shortens entries the
 * first time someone reads a long document is a worse first impression than no
 * detection at all, and `ask` is the only behaviour that cannot lose time.
 */
export const DEFAULT_IDLE_SETTINGS: IdleSettings = {
  enabled: false,
  thresholdMinutes: 10,
  behavior: "ask",
  lockIsImmediate: true,
};

/** Bounds shared by the zod schema, the Mongoose schema and the UI fields. */
export const MIN_IDLE_THRESHOLD_MINUTES = 1;
export const MAX_IDLE_THRESHOLD_MINUTES = 240;

/**
 * The policy that applies to a running entry: the workspace settings, with the
 * behaviour swapped for the project's own when it has one.
 *
 * A project override can never switch detection on — a workspace with idle
 * disabled stays disabled everywhere — so "Meetings" can opt out of pausing
 * without any project being able to opt the workspace in.
 */
export const resolveIdleSettings = (
  workspace: IdleSettings,
  projectBehavior: IdleBehavior | null | undefined,
): IdleSettings =>
  projectBehavior === null || projectBehavior === undefined
    ? workspace
    : { ...workspace, behavior: projectBehavior };

/** Short label, e.g. for the project row. */
export const idleBehaviorLabel = (behavior: IdleBehavior): string => {
  switch (behavior) {
    case "ask":
      return "Ask me";
    case "pause-and-resume":
      return "Pause and resume";
    case "keep-running":
      return "Keep running";
    case "stop":
      return "Stop the timer";
  }
};

/** One sentence saying what the behaviour actually does to the entry. */
export const idleBehaviorDescription = (behavior: IdleBehavior): string => {
  switch (behavior) {
    case "ask":
      return "Keep running and offer the choice when you get back. Nothing is discarded unless you say so.";
    case "pause-and-resume":
      return "End the entry where the idle time started, then reopen an identical one as soon as you come back.";
    case "keep-running":
      return "Never act on idle time. For reading, meetings and calls, where no input is normal.";
    case "stop":
      return "End the entry where the idle time started and leave the timer stopped.";
  }
};
