/**
 * Offline plumbing for the tracker.
 *
 * Every entry mutation goes out optimistically. When the request cannot reach
 * the server — the browser is offline, or the fetch fails at the transport
 * layer — the optimistic cache update stands and the mutation lands here, in a
 * durable FIFO — `localStorage` in a browser, Capacitor Preferences on the
 * native shells. On reconnect the queue is replayed in the order the user
 * performed the actions, so start/stop keeps working with the network fully
 * off.
 *
 * The op/payload contract itself now lives in `@starter/core` so the browser
 * extension writes rows this client can replay, and vice versa. What stays
 * here is the host-bound half: storage selection, the reactive pending count
 * React subscribes to, and the tRPC error classification.
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

import {
  preferencesStorage,
  shouldUseNativeStorage,
} from "@/mobile/preferences-storage";
import { getNetworkOnline } from "@/mobile/network";
import { isNative } from "@/mobile/bridge";

// ── the queue itself ─────────────────────────────────────────────────

/**
 * Where the queue lives.
 *
 * On the native shells this is Capacitor Preferences, not `localStorage`:
 * WKWebView may evict web storage after low disk or a week of inactivity, and
 * what is stored here is time the user tracked that the server has never seen.
 * `mobile/preferences-storage.ts` also hands over anything a previous build
 * left in `localStorage`, once — otherwise the change of address would itself
 * lose every queued row.
 *
 * `shouldUseNativeStorage()` is `isNative()`, a synchronous read of
 * `window.Capacitor` that the native bridge injects before any app code runs.
 * That is what makes it safe for `getOfflineQueue()` to memoise below: the
 * branch is decidable on the very first call, so there is no window in which
 * an early caller could pin the wrong backing store for the rest of the launch.
 */
const resolveStorage = (): KeyValueStorage => {
  if (typeof window === "undefined") return memoryStorage();
  if (shouldUseNativeStorage()) {
    return preferencesStorage({ migrateKeys: [OFFLINE_QUEUE_STORAGE_KEY] });
  }
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

/** Test seam: drop the memoised queue so the next call re-resolves storage. */
export const __resetOfflineQueueForTests = (): void => {
  queue = null;
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

/**
 * `meta.createdAt` is the raw row's timestamp, handed over separately rather
 * than folded into the decoded mutation: `decodeOfflineMutation` is core's
 * pure op contract and several clients pin its exact shape. The replay needs
 * the age because a queue that now survives an OS kill can hold a row for
 * days, and some of them stop being safe to replay blind.
 */
export const flushOfflineQueue = async (
  runner: (
    mutation: OfflineMutation,
    meta: { createdAt: string }
  ) => Promise<void>
): Promise<FlushResult> => {
  const result = await getOfflineQueue().flush(async (row) => {
    const decoded = decodeOfflineMutation(row);
    // A row we can no longer read is dropped by resolving successfully.
    if (decoded === null) return;
    await runner(decoded, { createdAt: row.createdAt });
  });
  await refreshPendingCount();
  return result;
};

export const clearOfflineQueue = async (): Promise<void> => {
  await getOfflineQueue().clear();
  await refreshPendingCount();
};

// ── the document going away ──────────────────────────────────────────

/*
 * A full page navigation aborts every request in flight, and an aborted fetch
 * is indistinguishable from a failed one — `isNetworkError()` says "network",
 * the mutation is queued, and the next document replays it.
 *
 * That guess is usually WRONG. The request was fully written before the
 * document died; aborting a fetch does not un-send the bytes, so the server
 * has almost always processed it and only the response was lost. Replaying it
 * therefore does not recover a lost entry — it creates a second one, and the
 * user is left deleting duplicates they did not make.
 *
 * So a mutation that fails while the document is being torn down is not
 * queued. The app is a moment away from reloading and asking the server what
 * is actually there, which is a better answer than a blind replay.
 *
 * **Web only.** There is no navigation-teardown on the native shells — the
 * document is loaded once and lives for the process — and `pagehide` fires
 * there for other reasons (backgrounding, the back-forward cache). A latched
 * flag on a phone would silently stop queueing offline work, which is the one
 * thing that must never happen. `persisted` is checked as well, so even on web
 * a bfcache suspension does not count.
 */
let documentUnloading = false;
let unwatchUnload: (() => void) | null = null;

export const isDocumentUnloading = (): boolean => documentUnloading;

export const watchDocumentUnload = (): void => {
  if (unwatchUnload !== null || typeof window === "undefined") return;
  if (isNative()) return;

  const onHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    documentUnloading = true;
  };
  // A restored page is alive again, and everything it does from here is a real
  // mutation by a real user.
  const onShow = (): void => {
    documentUnloading = false;
  };

  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  unwatchUnload = () => {
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("pageshow", onShow);
  };
};

/** Test seam. */
export const __resetDocumentUnloadForTests = (): void => {
  documentUnloading = false;
  unwatchUnload?.();
  unwatchUnload = null;
};

// ── error classification ─────────────────────────────────────────────

/**
 * Delegated to `mobile/network.ts`, which prefers the radio's own answer on
 * native and falls back to `navigator.onLine` everywhere else. In WKWebView
 * the browser's value is routinely `true` on a dead radio, and this function
 * is what `isNetworkError()` short-circuits on — so believing it files genuine
 * server refusals as transport failures and queues them forever.
 */
export const isOnline = (): boolean => getNetworkOnline();

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
 * True when the server refused the mutation because it does not believe the
 * caller is signed in.
 *
 * This is deliberately NOT a network error — the request arrived and was
 * answered — but it must not be treated as "the server has spoken, drop the
 * row" either. A queue that outlives an expired or revoked session would
 * otherwise delete a whole day of offline-tracked entries one 401 at a time,
 * invalidate the caches, and leave the user looking at an empty day with no
 * error anywhere. The flush stops instead, and everything keeps its place
 * until there is a session to replay it with.
 */
export const isAuthError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return false;
  const code = (data as { code?: unknown }).code;
  return code === "UNAUTHORIZED" || code === "FORBIDDEN";
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
