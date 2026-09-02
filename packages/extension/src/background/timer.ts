/**
 * Start and stop, with the offline queue underneath.
 *
 * Both paths build exactly one input object and then either send it or queue
 * it, so a mutation replayed tomorrow is identical to the one that failed
 * today. The cached running entry moves either way: the popup has to show a
 * running timer with the network off, which is the entire point of queueing
 * rather than erroring.
 */
import {
  createTempId,
  deviceTimeZone,
  type OfflineStartInput,
  type OfflineStopInput,
  type TimeEntry,
} from "@starter/core";
import { renderBadge } from "./badge";
import { BackgroundError } from "./errors";
import {
  ensureReady,
  enqueueOffline,
  flushQueue,
  getCachedProjects,
  invalidateRecents,
  isTransportFailure,
  ORIGIN_ID,
  rememberOptimisticRunning,
  setCachedRunning,
} from "./runtime";

const notSignedIn = (): BackgroundError =>
  new BackgroundError("NOT_SIGNED_IN", "Sign in before starting a timer.");

/**
 * The server resolves an omitted `billable` to `project.billableDefault ??
 * false`. The popup has no billable toggle, so we reproduce that rule here
 * instead of leaving the field out: the queued copy needs a concrete value,
 * and a replay tomorrow must not decide differently from the live call today.
 */
const billableDefaultFor = (projectId: string | null): boolean => {
  if (projectId === null) return false;
  const project = getCachedProjects()?.find((it) => it.id === projectId);
  return project?.billableDefault ?? false;
};

/**
 * What the server would have written, as far as the popup can tell. Only the
 * fields the popup renders are meaningful; `hourlyRate` and `currency` are
 * snapshotted server-side on stop, so guessing them here would be inventing
 * numbers. The temp id marks the entry as not-yet-real.
 */
const optimisticEntry = (
  input: OfflineStartInput,
  id: string,
  ownerId: string,
): TimeEntry => ({
  id,
  ownerId,
  description: input.description,
  projectId: input.projectId,
  taskId: input.taskId,
  billable: input.billable,
  start: input.start,
  end: null,
  durationSec: 0,
  hourlyRate: null,
  currency: "EUR",
  source: input.source,
  timeZone: input.timeZone,
  createdAt: input.start,
  updatedAt: input.start,
});

export async function startTimer(
  description: string,
  projectId: string | null,
  taskId: string | null = null,
  /**
   * Explicit for a quick start, omitted for the popup's own form.
   *
   * A favorite recorded its billable flag when it was pinned, and a recent
   * carries the flag its original entry was tracked with. Re-deriving either
   * from the project's current default would silently change what the user
   * asked for — and would make a queued replay disagree with the live call.
   */
  billable?: boolean,
): Promise<void> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  const input: OfflineStartInput = {
    description,
    projectId,
    taskId,
    billable: billable ?? billableDefaultFor(projectId),
    start: new Date().toISOString(),
    // Its own source, not "api": an entry made from the toolbar stays
    // traceable back to the toolbar.
    source: "extension",
    // Recorded here rather than server-side so a mutation queued offline keeps
    // the zone it was started in, not the one it happens to sync from.
    timeZone: deviceTimeZone(),
    originId: ORIGIN_ID,
  };

  // Drain first. A live start sent ahead of older queued mutations would be
  // stopped again the moment they replay.
  if ((await flushQueue()) > 0) {
    await queueStart(input, current.session.userId ?? "");
    return;
  }

  try {
    const entry = await current.api.mutate<TimeEntry>("entries.start", input);
    setCachedRunning(entry);
    // Starting stops whatever was running, so the entry log — and with it the
    // derived recents list — has moved on.
    invalidateRecents();
    await renderBadge(entry);
  } catch (error) {
    // A server rejection (validation, conflict, expired token) means the
    // mutation was seen and refused — replaying it would only be refused
    // again, so it goes back to the popup instead of into the queue.
    if (!isTransportFailure(error)) throw error;
    await queueStart(input, current.session.userId ?? "");
  }
}

const queueStart = async (
  input: OfflineStartInput,
  ownerId: string,
): Promise<void> => {
  const tempId = createTempId();
  await enqueueOffline("entries.start", input, tempId);
  const entry = optimisticEntry(input, tempId, ownerId);
  setCachedRunning(entry);
  // On disk as well as in memory: the queued row outlives this worker, so the
  // running timer it implies has to outlive it too.
  await rememberOptimisticRunning(entry);
  await renderBadge(entry);
};

export async function stopTimer(): Promise<void> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  // No `id`, deliberately: on replay the server stops whatever the
  // already-replayed start opened, which is the only entry that can still be
  // running by then. Pinning an id would name an entry that may not exist.
  const input: OfflineStopInput = {
    end: new Date().toISOString(),
    originId: ORIGIN_ID,
  };

  if ((await flushQueue()) > 0) {
    await queueStop(input);
    return;
  }

  try {
    await current.api.mutate<TimeEntry>("entries.stop", input);
    setCachedRunning(null);
    invalidateRecents();
    await renderBadge(null);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    await queueStop(input);
  }
}

const queueStop = async (input: OfflineStopInput): Promise<void> => {
  await enqueueOffline("entries.stop", input);
  setCachedRunning(null);
  // "A stop is queued" is itself a state worth surviving eviction — without it
  // a revived worker refetches and resurrects the entry this stop closed.
  await rememberOptimisticRunning(null);
  await renderBadge(null);
};
