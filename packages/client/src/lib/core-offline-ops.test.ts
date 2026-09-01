/**
 * Unit tests for the framework-free offline op contract in @starter/core:
 * temp ids, and the decoder that narrows a stored queue row back into a typed
 * mutation. Both are shared with the browser extension, so a row one client
 * writes has to survive the other's decode — or a stale row has to be dropped
 * rather than replayed blind.
 */
import { describe, expect, it } from "vitest";
import {
  createTempId,
  decodeOfflineMutation,
  isTempId,
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
