/**
 * The web client's offline replay path.
 *
 * The case that matters is the start: it is the only op that invents an id,
 * and a start replayed without renaming the idle watcher's claim leaves that
 * claim naming a temp id no reading will ever match again.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createIdleWatcher,
  type IdleSettings,
  type IdleTimerRef,
  type OfflineMutation,
  type OfflineStartInput,
} from "@starter/core";

import {
  replayOfflineMutation,
  type OfflineReplayMutators,
} from "@/hooks/replay-offline-mutation";

const START_INPUT: OfflineStartInput = {
  description: "Queued while the wifi was off",
  projectId: null,
  taskId: null,
  billable: false,
  start: "2026-09-02T09:00:00.000Z",
  source: "web",
  timeZone: "Europe/Berlin",
  originId: "tab-1",
};

const SERVER_ENTRY = { id: "68a7c1f2e4b0a9d3c5f10123", start: START_INPUT.start };

const queuedStart = (tempId?: string): OfflineMutation => ({
  queueId: "q1",
  tempId,
  op: "entries.start",
  input: START_INPUT,
});

/** Every op answers with the named entry; the assertions read the calls. */
const stubMutators = (
  overrides: Partial<OfflineReplayMutators> = {}
): OfflineReplayMutators => ({
  "entries.start": vi.fn(async () => SERVER_ENTRY),
  "entries.stop": vi.fn(async () => SERVER_ENTRY),
  "entries.create": vi.fn(async () => SERVER_ENTRY),
  "entries.update": vi.fn(async () => SERVER_ENTRY),
  "entries.remove": vi.fn(async () => SERVER_ENTRY),
  "entries.discard": vi.fn(async () => SERVER_ENTRY),
  ...overrides,
});

const spyWatcher = (): {
  noteServerId: (tempId: string, entryId: string) => void;
  calls: [string, string][];
} => {
  const calls: [string, string][] = [];
  return {
    noteServerId: (tempId, entryId) => calls.push([tempId, entryId]),
    calls,
  };
};

describe("replayOfflineMutation", () => {
  it("sends each op to its own mutator, with the queued input", async () => {
    const cases: OfflineMutation[] = [
      queuedStart("temp-1"),
      {
        queueId: "q2",
        op: "entries.stop",
        input: { end: START_INPUT.start, originId: "tab-1" },
      },
      {
        queueId: "q3",
        tempId: "temp-2",
        op: "entries.create",
        input: { ...START_INPUT, end: "2026-09-02T10:00:00.000Z" },
      },
      {
        queueId: "q4",
        op: "entries.update",
        input: { id: SERVER_ENTRY.id, billable: true, originId: "tab-1" },
      },
      {
        queueId: "q5",
        op: "entries.remove",
        input: { id: SERVER_ENTRY.id, originId: "tab-1" },
      },
      {
        queueId: "q6",
        op: "entries.discard",
        input: { originId: "tab-1" },
      },
    ];

    for (const mutation of cases) {
      const mutators = stubMutators();
      await replayOfflineMutation(mutators, spyWatcher(), mutation);
      for (const op of Object.keys(mutators) as (keyof typeof mutators)[]) {
        const spy = mutators[op] as ReturnType<typeof vi.fn>;
        if (op === mutation.op) expect(spy).toHaveBeenCalledWith(mutation.input);
        else expect(spy).not.toHaveBeenCalled();
      }
    }
  });

  it("renames the idle claim once a queued start reaches the server", async () => {
    const watcher = spyWatcher();
    await replayOfflineMutation(stubMutators(), watcher, queuedStart("temp-1"));
    expect(watcher.calls).toEqual([["temp-1", SERVER_ENTRY.id]]);
  });

  it("leaves the claim alone for ops that name an existing entry", async () => {
    const watcher = spyWatcher();
    await replayOfflineMutation(stubMutators(), watcher, {
      queueId: "q2",
      tempId: "temp-1",
      op: "entries.stop",
      input: { end: START_INPUT.start, originId: "tab-1" },
    });
    expect(watcher.calls).toEqual([]);
  });

  it("lets a rejection through so the flush can classify it", async () => {
    const boom = new Error("offline");
    const mutators = stubMutators({
      "entries.start": vi.fn(async () => {
        throw boom;
      }),
    });
    const watcher = spyWatcher();
    await expect(
      replayOfflineMutation(mutators, watcher, queuedStart("temp-1"))
    ).rejects.toBe(boom);
    // Nothing reached the server, so nothing to rename.
    expect(watcher.calls).toEqual([]);
  });

  it("restores idle detection for a timer this tab started offline", async () => {
    // End to end against the real watcher: `use-entry-mutations` claims the
    // entry under its temp id in `onMutate`, the start is queued, and only the
    // replay learns the real id. Without the rename the ownership check in
    // `observe` fails and idle detection never fires for that entry again.
    const settings: IdleSettings = {
      enabled: true,
      thresholdMinutes: 10,
      behavior: "stop",
      lockIsImmediate: true,
    };
    const startMs = Date.parse(START_INPUT.start);
    const timer: IdleTimerRef = {
      id: SERVER_ENTRY.id,
      start: START_INPUT.start,
      description: START_INPUT.description,
      projectId: START_INPUT.projectId,
      taskId: START_INPUT.taskId,
      billable: START_INPUT.billable,
    };
    const observe = (watcher: ReturnType<typeof createIdleWatcher>) =>
      watcher.observe({
        signal: "idle",
        atMs: startMs + 45 * 60_000,
        idleSinceMs: startMs + 5 * 60_000,
        timer,
        settings,
      });

    const watcher = createIdleWatcher();
    watcher.noteLocalStart("temp-1", startMs);
    expect(observe(watcher)).toEqual({ kind: "none" });

    await replayOfflineMutation(stubMutators(), watcher, queuedStart("temp-1"));
    expect(observe(watcher)).toMatchObject({
      kind: "truncate",
      entryId: SERVER_ENTRY.id,
    });
  });
});
