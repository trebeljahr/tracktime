/**
 * Offline plumbing for the tracker.
 *
 * Every entry mutation goes out optimistically. When the request cannot reach
 * the server — the browser is offline, or the fetch fails at the transport
 * layer — the optimistic cache update stands and the mutation lands here, in a
 * durable localStorage-backed FIFO. On reconnect the queue is replayed in the
 * order the user performed the actions, so start/stop keeps working with the
 * network fully off.
 *
 * The op/payload contract itself now lives in `@starter/core` so the browser
 * extension writes rows this client can replay, and vice versa. What stays
 * here is the browser-bound half: localStorage selection, the reactive pending
 * count React subscribes to, and the tRPC error classification.
 */

import {
  createOfflineQueue,
  decodeOfflineMutation,
  memoryStorage,
  OFFLINE_QUEUE_STORAGE_KEY,
  webStorage,
  type FlushResult,
  type KeyValueStorage,
  type OfflineMutation,
  type OfflineOp,
  type OfflinePayloadMap,
  type OfflineQueue,
  type StoredOfflinePayload,
} from "@starter/core";

export {
  createTempId,
  decodeOfflineMutation,
  isTempId,
  OFFLINE_QUEUE_STORAGE_KEY,
  TEMP_ID_PREFIX,
} from "@starter/core";

export type {
  OfflineCreateInput,
  OfflineDiscardInput,
  OfflineIdInput,
  OfflineMutation,
  OfflineOp,
  OfflinePayloadMap,
  OfflineStartInput,
  OfflineStopInput,
  OfflineUpdateInput,
} from "@starter/core";

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
  const payload: StoredOfflinePayload = tempId ? { input, tempId } : { input };
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
