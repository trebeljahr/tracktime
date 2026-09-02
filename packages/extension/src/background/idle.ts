/**
 * Idle detection in the service worker.
 *
 * `chrome.idle` is the only way an extension can learn that the person has
 * stopped using the machine: a worker sees no input events of its own, and the
 * popup exists only while it is open. The decision is `@starter/core/idle`,
 * shared with the web client and the desktop shell — this file is the detector
 * and the API calls that carry a decision out. The watcher's memory lives in
 * `./idle-state`.
 *
 * One Chrome fact shapes the whole design: **the detection interval is the
 * threshold**. Chrome reports `idle` after N seconds of no input and does not
 * report again until the state changes, so polling on a fixed short interval
 * would never tell us that ten minutes had passed. Setting N to the user's
 * threshold makes the event fire exactly when the decision is due, and makes
 * the idle start knowable: it began N seconds ago.
 */
import {
  resolveIdleSettings,
  type IdleAnswer,
  type IdlePlan,
  type IdleSignal,
  type IdleTimerRef,
  type TimeEntry,
} from "@starter/core";
import { renderBadge } from "./badge";
import { getIdleWatcher, persistIdleWatcher } from "./idle-state";
import {
  ensureReady,
  getCachedProjects,
  peekRunning,
  resolveRunning,
  resolveSettings,
} from "./runtime";
import { startTimer, stopTimer } from "./timer";

/** Chrome's floor for `setDetectionInterval`, in seconds. */
const MIN_DETECTION_SECONDS = 15;

const timerRefOf = (entry: TimeEntry | null): IdleTimerRef | null =>
  entry === null
    ? null
    : {
        id: entry.id,
        start: entry.start,
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        billable: entry.billable,
      };

const detectionSeconds = (thresholdMinutes: number): number =>
  Math.max(MIN_DETECTION_SECONDS, Math.round(thresholdMinutes * 60));

/**
 * Point `chrome.idle` at the user's threshold, so its event fires when the
 * decision is due rather than at some unrelated cadence. Returns the interval
 * in seconds, or null when idle detection is off for this workspace.
 *
 * Safe to call repeatedly — Chrome treats it as an assignment — and it has to
 * be called again after a settings change, or the old threshold sticks.
 */
export async function syncDetectionInterval(): Promise<number | null> {
  const settings = await resolveSettings();
  if (settings === null || !settings.idle.enabled) return null;
  const seconds = detectionSeconds(settings.idle.thresholdMinutes);
  chrome.idle.setDetectionInterval(seconds);
  return seconds;
}

const runPlan = async (plan: IdlePlan): Promise<void> => {
  switch (plan.kind) {
    case "none":
      return;

    case "prompt":
      // The worker has no UI of its own. The pending span is persisted by the
      // caller and handed to the popup by `buildState`, which asks there.
      // Nothing happens to the entry meanwhile — the timer keeps running,
      // which is the entire point of the `ask` behaviour.
      return;

    // `billable` is passed explicitly on both paths, for the same reason a
    // quick start passes it: the resumed entry continues work that was already
    // being tracked one way, and re-deriving the flag from the project's
    // current default would silently change it under the user.
    case "truncate":
      await stopTimer(plan.endAt);
      if (plan.resume === "now") {
        await startTimer(
          plan.seed.description,
          plan.seed.projectId,
          plan.seed.taskId,
          plan.seed.billable,
        );
      }
      return;

    case "resume":
      await startTimer(
        plan.seed.description,
        plan.seed.projectId,
        plan.seed.taskId,
        plan.seed.billable,
        plan.startAt,
      );
      return;
  }
};

/**
 * Feed one reading through the watcher and carry out whatever comes back.
 *
 * `idleSeconds` is how long the machine has been without input: Chrome's event
 * implies exactly the detection interval, and so does a `queryState` poll.
 */
export async function observeIdle(
  signal: IdleSignal,
  idleSeconds: number,
): Promise<void> {
  const current = await ensureReady();
  if (!current.session) return;

  const settings = await resolveSettings();
  if (settings === null || !settings.idle.enabled) return;

  // Offline, the cached view is the best answer available — and it is the
  // right one, because a decision taken offline is queued and replayed in the
  // order it was taken.
  let running = peekRunning();
  if (running === null) {
    try {
      running = await resolveRunning();
    } catch {
      running = peekRunning();
    }
  }

  const projectId = running?.projectId ?? null;
  const project =
    projectId === null
      ? undefined
      : getCachedProjects()?.find((candidate) => candidate.id === projectId);

  const atMs = Date.now();
  const watcher = await getIdleWatcher();
  const plan = watcher.observe({
    signal,
    atMs,
    idleSinceMs: atMs - Math.max(0, idleSeconds) * 1000,
    timer: timerRefOf(running),
    settings: resolveIdleSettings(settings.idle, project?.idleBehavior),
  });

  // Persisted before the plan runs: a worker evicted mid-mutation must not
  // wake believing it never decided anything and then decide all over again.
  await persistIdleWatcher();
  await runPlan(plan);
  await persistIdleWatcher();
  await renderBadge(peekRunning());
}

/** Answer a pending prompt from the popup. */
export async function answerIdle(choice: IdleAnswer): Promise<void> {
  const watcher = await getIdleWatcher();
  const plan = watcher.answer(choice, Date.now());
  await persistIdleWatcher();
  await runPlan(plan);
  await persistIdleWatcher();
  await renderBadge(peekRunning());
}

/**
 * Re-check the idle state without waiting for a transition.
 *
 * Chrome only fires `onStateChanged` on a change, and a change missed while
 * the browser was closed would otherwise never be acted on. The badge alarm
 * calls this, so the worst case is a 30-second delay rather than a decision
 * that never happens.
 */
export async function pollIdle(): Promise<void> {
  const seconds = await syncDetectionInterval();
  if (seconds === null) return;

  // Promisified by hand: this build's chrome types declare the callback form
  // only, and the callback's parameter is the narrow state union rather than
  // the promise resolver's widened type.
  const state = await new Promise<IdleSignal>((resolve) => {
    chrome.idle.queryState(seconds, (next) => resolve(next));
  });
  if (state === "active") return;
  await observeIdle(state, seconds);
}
