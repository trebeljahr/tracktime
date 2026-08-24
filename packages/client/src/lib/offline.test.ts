/**
 * Tests for the pure parts of the client's offline plumbing: temp ids, the
 * decoder that narrows a stored row back into a typed mutation, and the
 * network-vs-server error classification that decides whether an optimistic
 * update survives or rolls back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedMutation } from "@starter/core";
import {
  cancelQueuedForTemp,
  clearOfflineQueue,
  createTempId,
  decodeOfflineMutation,
  enqueueOffline,
  flushOfflineQueue,
  getOfflineQueue,
  getPendingCount,
  getServerPendingCount,
  isNetworkError,
  isOnline,
  isTempId,
  refreshPendingCount,
  subscribePending,
  type OfflineMutation,
  type OfflineStartInput,
} from "./offline";

const startInput: OfflineStartInput = {
  description: "Wrote tests",
  projectId: "p1",
  taskId: null,
  billable: true,
  start: "2026-08-21T09:00:00.000Z",
  source: "web",
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

describe("the client queue", () => {
  beforeEach(async () => {
    await clearOfflineQueue();
  });

  it("tracks the pending count as mutations are queued and flushed", async () => {
    expect(getPendingCount()).toBe(0);
    expect(getServerPendingCount()).toBe(0);

    await enqueueOffline("entries.start", startInput, "temp-1");
    await enqueueOffline("entries.stop", { end: "…", originId: "tab-1" });
    expect(getPendingCount()).toBe(2);
    expect(await refreshPendingCount()).toBe(2);

    const replayed: OfflineMutation[] = [];
    const result = await flushOfflineQueue(async (mutation) => {
      replayed.push(mutation);
    });

    expect(replayed.map((mutation) => mutation.op)).toEqual([
      "entries.start",
      "entries.stop",
    ]);
    expect(replayed[0].input).toEqual(startInput);
    expect(result).toEqual({ flushed: 2, remaining: 0 });
    expect(getPendingCount()).toBe(0);
  });

  it("notifies subscribers when the pending count changes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePending(listener);

    await enqueueOffline("entries.start", startInput);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    await clearOfflineQueue();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the remainder queued when a replay fails", async () => {
    await enqueueOffline("entries.start", startInput, "temp-1");
    await enqueueOffline("entries.stop", { end: "…", originId: "tab-1" });

    const result = await flushOfflineQueue(async (mutation) => {
      if (mutation.op === "entries.start") throw new Error("still offline");
    });

    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(2);
    expect(getPendingCount()).toBe(2);
  });

  it("drops an unreadable row instead of replaying it blind", async () => {
    await getOfflineQueue().enqueue("entries.frobnicate", { input: {} });
    await refreshPendingCount();

    const replayed: string[] = [];
    const result = await flushOfflineQueue(async (mutation) => {
      replayed.push(mutation.op);
    });

    expect(replayed).toEqual([]);
    expect(result.flushed).toBe(1);
    expect(getPendingCount()).toBe(0);
  });

  it("cancels everything queued for a temp entry", async () => {
    await enqueueOffline("entries.start", startInput, "temp-1");
    await enqueueOffline("entries.stop", { end: "…", originId: "tab-1" }, "temp-1");
    await enqueueOffline("entries.stop", { end: "…", originId: "tab-1" }, "temp-2");

    expect(await cancelQueuedForTemp("temp-1")).toBe(true);
    expect(getPendingCount()).toBe(1);

    expect(await cancelQueuedForTemp("temp-3")).toBe(false);
    expect(getPendingCount()).toBe(1);
  });
});

describe("isNetworkError", () => {
  it("assumes we are online in a non-browser host", () => {
    expect(isOnline()).toBe(true);
  });

  it("treats transport failures as retryable", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("fetch failed"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(
      true
    );
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
    expect(isNetworkError("connection refused")).toBe(true);
  });

  it("follows the cause chain", () => {
    const wrapped = new Error("mutation failed", {
      cause: new Error("socket hang up"),
    });
    expect(isNetworkError(wrapped)).toBe(true);
  });

  it("never retries a rejection that came from the server", () => {
    const rejected = Object.assign(new Error("Failed to fetch"), {
      data: { code: "BAD_REQUEST" },
    });
    expect(isNetworkError(rejected)).toBe(false);
  });

  it("does not treat an ordinary error as a network error", () => {
    expect(isNetworkError(new Error("Entry not found"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({ nope: true })).toBe(false);
  });
});
