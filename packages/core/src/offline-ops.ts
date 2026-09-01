/**
 * The op/payload contract for entry mutations that were queued offline.
 *
 * `offline-queue.ts` stores opaque rows; this module is what gives those rows
 * meaning. It lives in core rather than the web client because every client
 * that can mutate entries — the web app, the extension's service worker, the
 * Raycast client — must agree on the op names and payload shapes, or one of
 * them writes rows another cannot replay. Everything here is pure: no window,
 * no React, no tRPC. The replay runner that actually calls the API stays with
 * whichever client owns the API binding.
 */

import { createId } from "./ids.js";
import type { QueuedMutation } from "./offline-queue.js";
import type { EntrySource } from "@starter/shared";

export const OFFLINE_QUEUE_STORAGE_KEY = "tracktime.offline-queue";

/** Entries invented client-side carry this prefix until the server replies. */
export const TEMP_ID_PREFIX = "temp-";

/** Id for an entry that exists only in the cache and the offline queue. */
export const createTempId = (): string => `${TEMP_ID_PREFIX}${createId()}`;

export const isTempId = (id: string): boolean => id.startsWith(TEMP_ID_PREFIX);

// ── payloads ─────────────────────────────────────────────────────────

export type OfflineStartInput = {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  start: string;
  source: EntrySource;
  /** IANA zone this was recorded in. Replayed unchanged, so a queued entry
   *  keeps the zone it was created in rather than the zone it syncs from. */
  timeZone: string;
  originId: string;
};

export type OfflineStopInput = {
  /** Omitted on purpose during replay — stop whatever is running server-side. */
  id?: string;
  end: string;
  originId: string;
};

export type OfflineCreateInput = {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  start: string;
  end: string;
  source: EntrySource;
  timeZone: string;
  originId: string;
};

export type OfflineUpdateInput = {
  id: string;
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  start?: string;
  end?: string | null;
  originId: string;
};

export type OfflineIdInput = {
  id: string;
  originId: string;
};

export type OfflineDiscardInput = {
  id?: string;
  originId: string;
};

export type OfflinePayloadMap = {
  "entries.start": OfflineStartInput;
  "entries.stop": OfflineStopInput;
  "entries.create": OfflineCreateInput;
  "entries.update": OfflineUpdateInput;
  "entries.remove": OfflineIdInput;
  "entries.discard": OfflineDiscardInput;
};

export type OfflineOp = keyof OfflinePayloadMap;

const OFFLINE_OPS: readonly string[] = [
  "entries.start",
  "entries.stop",
  "entries.create",
  "entries.update",
  "entries.remove",
  "entries.discard",
];

const isOfflineOp = (value: string): value is OfflineOp =>
  OFFLINE_OPS.includes(value);

/** A queued mutation, narrowed back to its typed input. */
export type OfflineMutation = {
  [K in OfflineOp]: {
    /** Queue entry id, not the entry id. */
    queueId: string;
    op: K;
    input: OfflinePayloadMap[K];
    /** Temp id of the entry this mutation invented, when it invented one. */
    tempId?: string;
  };
}[OfflineOp];

/** The envelope `enqueueOffline` writes into a queue row's payload. */
export type StoredOfflinePayload = { input: unknown; tempId?: string };

const readStored = (payload: unknown): StoredOfflinePayload | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { input?: unknown; tempId?: unknown };
  if (typeof record.input !== "object" || record.input === null) return null;
  return {
    input: record.input,
    tempId: typeof record.tempId === "string" ? record.tempId : undefined,
  };
};

/**
 * Narrow a raw queue row back into a typed mutation. Returns null for rows
 * written by an older build — a stale row must be dropped, never replayed
 * blind against a schema it no longer matches.
 */
export const decodeOfflineMutation = (
  mutation: QueuedMutation
): OfflineMutation | null => {
  if (!isOfflineOp(mutation.op)) return null;
  const stored = readStored(mutation.payload);
  if (stored === null) return null;

  const queueId = mutation.id;
  const tempId = stored.tempId;

  switch (mutation.op) {
    case "entries.start":
      return {
        queueId,
        tempId,
        op: "entries.start",
        input: stored.input as OfflineStartInput,
      };
    case "entries.stop":
      return {
        queueId,
        tempId,
        op: "entries.stop",
        input: stored.input as OfflineStopInput,
      };
    case "entries.create":
      return {
        queueId,
        tempId,
        op: "entries.create",
        input: stored.input as OfflineCreateInput,
      };
    case "entries.update":
      return {
        queueId,
        tempId,
        op: "entries.update",
        input: stored.input as OfflineUpdateInput,
      };
    case "entries.remove":
      return {
        queueId,
        tempId,
        op: "entries.remove",
        input: stored.input as OfflineIdInput,
      };
    case "entries.discard":
      return {
        queueId,
        tempId,
        op: "entries.discard",
        input: stored.input as OfflineDiscardInput,
      };
  }
};
