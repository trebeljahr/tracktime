/**
 * Offline plumbing for the tracker.
 *
 * Every entry mutation goes out optimistically. When the request cannot reach
 * the server — the browser is offline, or the fetch fails at the transport
 * layer — the optimistic cache update stands and the mutation lands here, in a
 * durable localStorage-backed FIFO. On reconnect the queue is replayed in the
 * order the user performed the actions, so start/stop keeps working with the
 * network fully off.
 */

import {
  createId,
  createOfflineQueue,
  memoryStorage,
  webStorage,
  type EntrySource,
  type FlushResult,
  type KeyValueStorage,
  type OfflineQueue,
  type QueuedMutation,
} from "@starter/core";

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

type StoredPayload = { input: unknown; tempId?: string };

const readStored = (payload: unknown): StoredPayload | null => {
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

// ── the queue itself ─────────────────────────────────────────────────

const resolveStorage = (): KeyValueStorage => {
  if (typeof window === "undefined") return memoryStorage();
  try {
    return webStorage(window.localStorage);
  } catch {
    // Privacy mode / disabled storage — the queue still works for this tab.
    return memoryStorage();
  }
};

let queue: OfflineQueue | null = null;

export const getOfflineQueue = (): OfflineQueue => {
  if (queue === null) {
    queue = createOfflineQueue({
      storage: resolveStorage(),
      key: OFFLINE_QUEUE_STORAGE_KEY,
    });
  }
  return queue;
};

// ── reactive pending count ───────────────────────────────────────────

type Listener = () => void;

let pending = 0;
const listeners = new Set<Listener>();

const setPending = (next: number): void => {
  if (next === pending) return;
  pending = next;
  for (const listener of listeners) listener();
};

export const subscribePending = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPendingCount = (): number => pending;

/** Server snapshot for `useSyncExternalStore` — nothing is ever queued on SSR. */
export const getServerPendingCount = (): number => 0;

export const refreshPendingCount = async (): Promise<number> => {
  const size = await getOfflineQueue().size();
  setPending(size);
  return size;
};

/** Append a mutation that could not reach the server. */
export const enqueueOffline = async <K extends OfflineOp>(
  op: K,
  input: OfflinePayloadMap[K],
  tempId?: string
): Promise<void> => {
  const payload: StoredPayload = tempId ? { input, tempId } : { input };
  await getOfflineQueue().enqueue(op, payload);
  await refreshPendingCount();
};

/**
 * Drop everything queued for a temp entry. Used when the user deletes an
 * entry they created while offline — replaying its create would resurrect it.
 */
export const cancelQueuedForTemp = async (tempId: string): Promise<boolean> => {
  const offlineQueue = getOfflineQueue();
  const rows = await offlineQueue.list();
  let removed = false;

  for (const row of rows) {
    const decoded = decodeOfflineMutation(row);
    if (decoded?.tempId !== tempId) continue;
    await offlineQueue.remove(row.id);
    removed = true;
  }

  if (removed) await refreshPendingCount();
  return removed;
};

export const flushOfflineQueue = async (
  runner: (mutation: OfflineMutation) => Promise<void>
): Promise<FlushResult> => {
  const result = await getOfflineQueue().flush(async (row) => {
    const decoded = decodeOfflineMutation(row);
    // A row we can no longer read is dropped by resolving successfully.
    if (decoded === null) return;
    await runner(decoded);
  });
  await refreshPendingCount();
  return result;
};

export const clearOfflineQueue = async (): Promise<void> => {
  await getOfflineQueue().clear();
  await refreshPendingCount();
};

// ── error classification ─────────────────────────────────────────────

export const isOnline = (): boolean => {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
};

/** A tRPC error carrying `data.code` came from the server, not the wire. */
const hasServerCode = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  return typeof (data as { code?: unknown }).code === "string";
};

const NETWORK_MARKERS = [
  "failed to fetch",
  "fetch failed",
  "networkerror",
  "network error",
  "network request failed",
  "load failed",
  "err_internet_disconnected",
  "err_network",
  "err_connection",
  "connection refused",
  "socket hang up",
  "offline",
];

const messagesOf = (error: unknown): string[] => {
  const messages: string[] = [];
  let cursor: unknown = error;

  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (typeof cursor === "string") {
      messages.push(cursor);
      break;
    }
    if (typeof cursor !== "object") break;
    const record = cursor as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string") messages.push(record.message);
    cursor = record.cause;
  }

  return messages;
};

/**
 * True when the mutation never reached the server, so it is safe to keep the
 * optimistic update and replay later. A server rejection (validation,
 * conflict, auth) is never a network error — those must roll back.
 */
export const isNetworkError = (error: unknown): boolean => {
  if (hasServerCode(error)) return false;
  if (!isOnline()) return true;
  if (error instanceof TypeError) return true;

  return messagesOf(error).some((message) => {
    const lower = message.toLowerCase();
    return NETWORK_MARKERS.some((marker) => lower.includes(marker));
  });
};
