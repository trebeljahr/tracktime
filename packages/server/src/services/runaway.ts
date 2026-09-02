/**
 * The runaway-timer guard, evaluated on the server.
 *
 * ── Why there is no cron here ────────────────────────────────────────
 *
 * The next person will look for a scheduler and not find one. There isn't one
 * anywhere in this server — no cron, no job runner, nothing but the WebSocket
 * heartbeat's `setInterval` — and adding the first one for this would be the
 * wrong trade:
 *
 *  - The guard is evaluated LAZILY, whenever something resolves "what is
 *    running": `entries.current`, opening a timer by starting another one, and
 *    joining the sync room on a fresh socket. Nobody learns about a runaway
 *    until they look, and when they look is exactly when it is evaluated. The
 *    read that would have shown a stale 63-hour timer is the read that fixes
 *    it, so from the user's side the two are indistinguishable.
 *  - It costs no new infrastructure and cannot fall behind, get stuck, or need
 *    a lock. A scheduler would need one the moment this process is scaled past
 *    a single instance (it isn't today, and the guard should not be the reason
 *    it has to care).
 *
 * What lazy evaluation genuinely cannot do is notify proactively — no push
 * arrives on Saturday morning saying the Friday timer is still going. That is
 * the price, and it is the right one to pay until there is a push channel for
 * such a notification to travel down. If one is ever added, the decision
 * itself is pure and unchanged (`@starter/shared/runaway`); only the call site
 * moves.
 *
 * ── Why it cannot live in a client ───────────────────────────────────
 *
 * Idle detection runs on a device, watching that device's input. The failure
 * THIS guard catches is the one where the laptop was shut all weekend and no
 * client was running at all. A client-side guard is structurally unable to see
 * it.
 *
 * ── Author-scoped, like every other running-timer path ───────────────
 *
 * The running entry is found by `authorId` and carries no workspace filter,
 * for the same reason `entries.stop` does: one running timer per HUMAN across
 * every workspace they belong to. The maximum therefore comes from the
 * person's preferences (see MaxDurationSettings), while the rate snapshot on a
 * cap comes from the ENTRY's workspace — `finalizeStop` already gets that
 * right — and the event is published into that workspace, which may not be the
 * one whose read triggered the guard.
 *
 * ── How it and idle stay out of each other's way ─────────────────────
 *
 * Whichever sets `end` first wins, and neither has to know the other exists:
 *
 *  - The guard only ever considers an entry with `end === null`, and both of
 *    its acting behaviours go through `finalizeStop`, whose filter includes
 *    `end: null`. If idle already stopped or paused the entry, the guard finds
 *    nothing running (or finds the fresh entry a pause-and-resume opened,
 *    whose start is recent and therefore under the limit).
 *  - In the other direction, an idle watcher that wakes up after a cap calls
 *    `entries.stop`, which rejects an entry that is no longer running.
 *  - The `ask` behaviour writes a marker and nothing else. It never sets
 *    `end`, so it does not race at all: idle stays free to act, and it is the
 *    better-informed of the two, because it knows when input actually stopped.
 */
import {
  evaluateRunaway,
  type MaxDurationSettings,
  type SyncEvent,
  type TimeEntry as TimeEntryWire,
} from "@starter/shared";
import { getOrCreateUserPreferences } from "../models/Settings.js";
import {
  TimeEntry,
  toClientTimeEntry,
  type RunawayDoc,
} from "../models/TimeEntry.js";
import { publishSync } from "../ws/sync.js";
import { finalizeStop } from "./entry-stop.js";

export type GuardOutcome =
  | { kind: "none" }
  | { kind: "flagged"; entry: TimeEntryWire }
  | { kind: "ended"; entry: TimeEntryWire };

/**
 * Look at whatever this person has running and act on it if it has run away.
 *
 * Deliberately never takes an `originId`. A server-initiated cap has no
 * originating client, and passing the originId of whoever happened to trigger
 * the read would make exactly that one device — usually the device sitting in
 * front of the person — the only one that ignores the event. Publishing with
 * no originId means every connected device updates, which is the correct
 * meaning of "this did not come from any of you".
 *
 * Never throws: a read of the running entry must not fail because the guard
 * could not write. A guard that breaks `entries.current` is worse than a
 * runaway timer.
 */
export async function enforceMaxEntryDuration(
  userId: string,
  now: Date = new Date(),
): Promise<GuardOutcome> {
  try {
    return await run(userId, now);
  } catch {
    return { kind: "none" };
  }
}

const run = async (userId: string, now: Date): Promise<GuardOutcome> => {
  const preferences = await getOrCreateUserPreferences(userId);
  const maxDuration: MaxDurationSettings = preferences.maxDuration;

  // Cheapest possible exit, and the common one: read no entry at all when the
  // guard is switched off.
  if (maxDuration.maxHours <= 0) return { kind: "none" };

  // No workspace filter, on purpose — see the header.
  const running = await TimeEntry.findOne({ authorId: userId, end: null })
    .lean();
  if (!running) return { kind: "none" };

  const decision = evaluateRunaway({
    startMs: running.start.getTime(),
    nowMs: now.getTime(),
    settings: maxDuration,
    existing: running.runaway
      ? {
          detectedAt: running.runaway.detectedAt.toISOString(),
          elapsedSec: running.runaway.elapsedSec,
          limitSec: running.runaway.limitSec,
          action: running.runaway.action,
          resolvedAt: running.runaway.resolvedAt
            ? running.runaway.resolvedAt.toISOString()
            : null,
        }
      : null,
  });

  if (decision.kind === "none") return { kind: "none" };

  const mark: RunawayDoc = {
    detectedAt: new Date(decision.mark.detectedAt),
    elapsedSec: decision.mark.elapsedSec,
    limitSec: decision.mark.limitSec,
    action: decision.mark.action,
    resolvedAt: null,
  };

  if (decision.kind === "flag") {
    // Still running, still occupying the one-running-timer slot. The only
    // thing that changed is that the entry now knows it is suspicious, and
    // `entry.upserted` is the event for "this entry changed but the timer did
    // not stop" — no new protocol kind is needed for any of this.
    const flagged = await TimeEntry.findOneAndUpdate(
      { _id: String(running._id), authorId: userId, end: null, runaway: null },
      { $set: { runaway: mark } },
      { returnDocument: "after" },
    ).lean();
    if (!flagged) return { kind: "none" };

    const entry = toClientTimeEntry(flagged);
    publish(running.workspaceId, { kind: "entry.upserted", entry });
    return { kind: "flagged", entry };
  }

  const stopped = await finalizeStop(running, new Date(decision.endMs), mark);
  // Lost the race with an idle watcher, a Stop tap or a concurrent guard on
  // another request. The other write is just as valid an ending as ours.
  if (!stopped) return { kind: "none" };

  publish(running.workspaceId, { kind: "timer.stopped", entry: stopped });
  return { kind: "ended", entry: stopped };
};

/** Into the entry's OWN workspace, which may not be the one that asked. */
const publish = (workspaceId: string, event: SyncEvent): void => {
  void publishSync(workspaceId, event);
};
