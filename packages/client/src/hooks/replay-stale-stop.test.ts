/**
 * A queued `entries.stop` that names no entry.
 *
 * `id` is omitted on purpose for a timer that was started offline: the only id
 * it has is a temp one the server has never seen, so the server is asked to
 * "stop whatever is running". That was safe while the queue lived in
 * localStorage on a machine that is rarely off — a row that could not replay
 * evaporated with the tab. On a phone the queue survives an OS kill for as
 * long as the app is installed, and "whatever is running" days later is a
 * different entry, quite possibly on a different device, stopped at a
 * timestamp from another week.
 *
 * Two answers, in order of preference: thread the real id in from the start
 * that replayed moments earlier in the same flush, and refuse the ones that
 * cannot be identified and are too old to guess for.
 */
import { describe, expect, it, vi } from "vitest";
import type { OfflineMutation } from "@starter/core";

import {
  replayOfflineMutation,
  StaleQueuedStopError,
  STALE_STOP_MS,
  type OfflineReplayMutators,
  type ReplayIdMap,
} from "@/hooks/replay-offline-mutation";

const watcher = { noteServerId: vi.fn() };

const mutators = (): OfflineReplayMutators & { calls: unknown[] } => {
  const calls: unknown[] = [];
  const record =
    (op: string) =>
    async (input: unknown): Promise<unknown> => {
      calls.push({ op, input });
      return { id: "server-1" };
    };
  return {
    calls,
    "entries.start": record("entries.start"),
    "entries.stop": record("entries.stop"),
    "entries.create": record("entries.create"),
    "entries.update": record("entries.update"),
    "entries.remove": record("entries.remove"),
    "entries.discard": record("entries.discard"),
  } as OfflineReplayMutators & { calls: unknown[] };
};

const startRow = (tempId: string): OfflineMutation =>
  ({
    queueId: "q1",
    op: "entries.start",
    tempId,
    input: { originId: "tab-1" },
  }) as OfflineMutation;

const stopRow = (
  input: { id?: string; end: string; originId: string },
  tempId?: string,
): OfflineMutation =>
  ({ queueId: "q2", op: "entries.stop", tempId, input }) as OfflineMutation;

const now = (): string => new Date().toISOString();
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe("replaying a queued stop", () => {
  it("inherits the id its start was just given", async () => {
    const m = mutators();
    const resolved: ReplayIdMap = new Map();

    await replayOfflineMutation(m, watcher, startRow("temp-1"), {
      createdAt: now(),
      resolved,
    });
    await replayOfflineMutation(
      m,
      watcher,
      stopRow({ end: "2026-08-21T10:00:00.000Z", originId: "tab-1" }, "temp-1"),
      { createdAt: now(), resolved },
    );

    expect(m.calls[1]).toEqual({
      op: "entries.stop",
      input: {
        id: "server-1",
        end: "2026-08-21T10:00:00.000Z",
        originId: "tab-1",
      },
    });
  });

  it("leaves an already-targeted stop exactly as it was queued", async () => {
    const m = mutators();
    const input = { id: "e9", end: "2026-08-21T10:00:00.000Z", originId: "t" };

    await replayOfflineMutation(m, watcher, stopRow(input), {
      createdAt: daysAgo(30),
      resolved: new Map(),
    });

    // Old, but unambiguous: age is only a problem when we are guessing.
    expect(m.calls[0]).toEqual({ op: "entries.stop", input });
  });

  it("still stops whatever is running for a recent unidentifiable row", async () => {
    const m = mutators();
    const input = { end: "2026-08-21T10:00:00.000Z", originId: "t" };

    await replayOfflineMutation(m, watcher, stopRow(input), {
      createdAt: now(),
      resolved: new Map(),
    });

    expect(m.calls[0]).toEqual({ op: "entries.stop", input });
  });

  it("refuses an unidentifiable row from days ago", async () => {
    const m = mutators();

    await expect(
      replayOfflineMutation(
        m,
        watcher,
        stopRow({ end: "2026-08-21T10:00:00.000Z", originId: "t" }),
        { createdAt: daysAgo(5), resolved: new Map() },
      ),
    ).rejects.toBeInstanceOf(StaleQueuedStopError);

    expect(m.calls).toHaveLength(0);
  });

  it("refuses one whose start never resolved, rather than aiming blind", async () => {
    const m = mutators();
    const stale = new Date(Date.now() - STALE_STOP_MS - 1000).toISOString();

    await expect(
      replayOfflineMutation(
        m,
        watcher,
        stopRow({ end: "2026-08-21T10:00:00.000Z", originId: "t" }, "temp-9"),
        { createdAt: stale, resolved: new Map() },
      ),
    ).rejects.toBeInstanceOf(StaleQueuedStopError);
  });
});
