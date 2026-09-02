/**
 * Unit tests for the framework-free offline op contract in @starter/core:
 * temp ids, and the decoder that narrows a stored queue row back into a typed
 * mutation. Both are shared with the browser extension, so a row one client
 * writes has to survive the other's decode — or a stale row has to be dropped
 * rather than replayed blind.
 */
import { describe, expect, it } from "vitest";
import {
  createIdleWatcher,
  createTempId,
  decodeOfflineMutation,
  isTempId,
  noteReplayedServerId,
  type IdleSettings,
  type IdleTimerRef,
  type OfflineMutation,
  type OfflineStartInput,
  type QueuedMutation,
} from "@starter/core";

const startInput: OfflineStartInput = {
  description: "Wrote tests",
  projectId: "p1",
  taskId: null,
  billable: true,
  start: "2026-08-21T09:00:00.000Z",
  source: "web",
      timeZone: "Europe/Berlin",
  originId: "tab-1",
};

const row = (op: string, payload: unknown, id = "q1"): QueuedMutation => ({
  id,
  op,
  payload,
  createdAt: "2026-08-21T09:00:00.000Z",
});

describe("temp ids", () => {
  it("marks ids invented client-side", () => {
    const id = createTempId();
    expect(isTempId(id)).toBe(true);
    expect(id.startsWith("temp-")).toBe(true);
  });

  it("does not mistake a server id for a temp id", () => {
    expect(isTempId("68a7c1f2e4b0a9d3c5f10123")).toBe(false);
  });

  it("mints a fresh id every time", () => {
    expect(createTempId()).not.toBe(createTempId());
  });
});

describe("decodeOfflineMutation", () => {
  it("narrows a stored row back to its typed input", () => {
    const decoded = decodeOfflineMutation(
      row("entries.start", { input: startInput, tempId: "temp-1" })
    );
    expect(decoded).toEqual({
      queueId: "q1",
      tempId: "temp-1",
      op: "entries.start",
      input: startInput,
    });
  });

  it("decodes every supported op", () => {
    const ops = [
      "entries.start",
      "entries.stop",
      "entries.create",
      "entries.update",
      "entries.remove",
      "entries.discard",
    ];
    for (const op of ops) {
      const decoded = decodeOfflineMutation(row(op, { input: { originId: "t" } }));
      expect(decoded?.op).toBe(op);
    }
  });

  it("leaves tempId undefined when the row carries none", () => {
    const decoded = decodeOfflineMutation(row("entries.stop", { input: {} }));
    expect(decoded?.tempId).toBeUndefined();
  });

  it("drops rows written by an older build", () => {
    expect(decodeOfflineMutation(row("entries.pause", { input: {} }))).toBeNull();
    expect(decodeOfflineMutation(row("projects.create", { input: {} }))).toBeNull();
  });

  it("drops rows whose payload is not a stored input envelope", () => {
    expect(decodeOfflineMutation(row("entries.start", null))).toBeNull();
    expect(decodeOfflineMutation(row("entries.start", "oops"))).toBeNull();
    expect(decodeOfflineMutation(row("entries.start", {}))).toBeNull();
    expect(decodeOfflineMutation(row("entries.start", { input: null }))).toBeNull();
    expect(decodeOfflineMutation(row("entries.start", { input: 7 }))).toBeNull();
  });

  it("ignores a tempId of the wrong type", () => {
    const decoded = decodeOfflineMutation(
      row("entries.start", { input: startInput, tempId: 42 })
    );
    expect(decoded?.tempId).toBeUndefined();
  });
});

describe("noteReplayedServerId", () => {
  /** The queued start, as `flushQueue` decodes it just before replaying it. */
  const queuedStart = (tempId?: string): OfflineMutation => ({
    queueId: "q1",
    tempId,
    op: "entries.start",
    input: startInput,
  });

  /** What the server hands back once the row finally reaches it. */
  const realEntry = { id: "68a7c1f2e4b0a9d3c5f10123", start: startInput.start };

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

  it("renames the claim a replayed start was queued under", () => {
    const watcher = spyWatcher();
    expect(
      noteReplayedServerId(watcher, queuedStart("temp-1"), realEntry)
    ).toBe(true);
    expect(watcher.calls).toEqual([["temp-1", realEntry.id]]);
  });

  it("leaves every other op alone — only a start invents an id", () => {
    const watcher = spyWatcher();
    const stop: OfflineMutation = {
      queueId: "q2",
      tempId: "temp-1",
      op: "entries.stop",
      input: { end: startInput.start, originId: "tab-1" },
    };
    expect(noteReplayedServerId(watcher, stop, realEntry)).toBe(false);
    expect(watcher.calls).toEqual([]);
  });

  it("does nothing for a row queued without a temp id", () => {
    const watcher = spyWatcher();
    expect(noteReplayedServerId(watcher, queuedStart(), realEntry)).toBe(false);
    expect(watcher.calls).toEqual([]);
  });

  it("does nothing when the replay result carries no usable id", () => {
    const watcher = spyWatcher();
    for (const result of [null, undefined, "ok", {}, { id: 7 }, { id: "" }]) {
      expect(noteReplayedServerId(watcher, queuedStart("temp-1"), result)).toBe(
        false
      );
    }
    expect(watcher.calls).toEqual([]);
  });

  it("restores idle detection for a timer that was started offline", () => {
    // The whole point, end to end. A start made with the network off is
    // claimed against its temp id, because that is the only id it has. Without
    // the rename on replay the claim still names the temp id, the ownership
    // check in `observe` fails against the real entry, and idle detection
    // silently never fires again for that entry.
    const settings: IdleSettings = {
      enabled: true,
      thresholdMinutes: 10,
      behavior: "stop",
      lockIsImmediate: true,
    };
    const startMs = Date.parse(startInput.start);
    const timer: IdleTimerRef = {
      id: realEntry.id,
      start: startInput.start,
      description: startInput.description,
      projectId: startInput.projectId,
      taskId: startInput.taskId,
      billable: startInput.billable,
    };
    const observe = (watcher: ReturnType<typeof createIdleWatcher>) =>
      watcher.observe({
        signal: "idle",
        atMs: startMs + 45 * 60_000,
        idleSinceMs: startMs + 5 * 60_000,
        timer,
        settings,
      });

    const stale = createIdleWatcher();
    stale.noteLocalStart("temp-1", startMs);
    expect(observe(stale)).toEqual({ kind: "none" });

    const renamed = createIdleWatcher();
    renamed.noteLocalStart("temp-1", startMs);
    expect(
      noteReplayedServerId(renamed, queuedStart("temp-1"), realEntry)
    ).toBe(true);
    expect(observe(renamed)).toMatchObject({
      kind: "truncate",
      entryId: realEntry.id,
    });
  });
});
