/**
 * Everything stateful in the extension lives here, and all of it is
 * disposable.
 *
 * MV3 evicts an idle service worker after about 30 seconds and re-creates it
 * from scratch on the next event, so nothing in this worker may be *kept* — it
 * may only be *cached*. {@link ensureReady} is the recovery path: it rebuilds
 * the session, the API client, the offline queue and the sync socket from
 * `chrome.storage` alone, and every entry point in the worker awaits it before
 * touching anything. The module-level variables below are therefore caches
 * whose cold-start value is "empty", never the source of truth.
 */
import {
  ApiError,
  createApiClient,
  createId,
  createOfflineQueue,
  createSyncClient,
  decodeOfflineMutation,
  OFFLINE_QUEUE_STORAGE_KEY,
  type ApiClient,
  type Client,
  type KeyValueStorage,
  type OfflineOp,
  type OfflinePayloadMap,
  type OfflineQueue,
  type Project,
  type StoredOfflinePayload,
  type SyncClient,
  type SyncEvent,
  type SyncStatus,
  type Task,
  type TimeEntry,
} from "@starter/core";
import { chromeStorage, localStorageArea } from "../lib/chrome-storage";
import type { SessionSource } from "../lib/messaging";
import { EXTENSION_CLIENT_ID, loadApiUrl, syncUrlFrom } from "../lib/config";
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
} from "../lib/session";
import { clearWebSessionCookie, readWebSessionToken } from "../lib/web-session";
import { renderBadge } from "./badge";

/** The rebuildable half of the worker: config plus whatever it configures. */
export type Runtime = {
  apiUrl: string;
  session: StoredSession | null;
  /**
   * Whether `session` was adopted from the web app's cookie or created by this
   * extension's own password sign-in. It decides what sign-out has to tear
   * down, and it is never persisted — it is re-derived on every rebuild.
   */
  sessionSource: SessionSource | null;
  api: ApiClient;
};

/**
 * Tags mutations this worker made so the sync socket's echo of our own write
 * can be dropped instead of re-applied.
 *
 * Deliberately regenerated per worker instance rather than persisted: a fresh
 * id after an eviction can only make us *apply* our own echo, which is
 * idempotent, whereas a persisted one risks silently ignoring a genuine event
 * from a different instance that happened to reuse it.
 */
export const ORIGIN_ID: string = createId();

let runtime: Runtime | null = null;
let building: Promise<Runtime> | null = null;

let sync: SyncClient | null = null;
let syncStatus: SyncStatus = "closed";

/**
 * `null` means "we have never looked"; `{ entry: null }` means "we looked and
 * nothing is running". The distinction is what keeps the badge alarm from
 * fetching every 30 seconds — see {@link resolveRunning}.
 */
let cachedRunning: { entry: TimeEntry | null } | null = null;
let runningLookup: Promise<TimeEntry | null> | null = null;

let cachedProjects: Project[] | null = null;
let cachedClients: Client[] | null = null;
let cachedTodaySec: number | null = null;

/** Tasks are per-project, so the cache has to remember which project's. */
let cachedTasks: { projectId: string; tasks: Task[] } | null = null;

/** Discovered once per API URL from /api/health; null until then. */
let cachedWebUrl: string | null = null;

/**
 * The signed-in address. A password sign-in returns it, but a session adopted
 * from the web app's cookie carries only the token — so for that path it has
 * to be asked for, once, rather than left blank in the popup's footer.
 */
let cachedEmail: string | null = null;

let queue: OfflineQueue | null = null;

// ── the offline queue ────────────────────────────────────────────────

/**
 * Backed by `chrome.storage.local` under core's own default key, so a
 * mutation queued here is a row the web client could also replay — the op
 * contract in `@starter/core/offline-ops` is shared on purpose.
 */
export const getOfflineQueue = (): OfflineQueue => {
  queue ??= createOfflineQueue({
    storage: chromeStorage(localStorageArea()),
    key: OFFLINE_QUEUE_STORAGE_KEY,
  });
  return queue;
};

export async function enqueueOffline<K extends OfflineOp>(
  op: K,
  input: OfflinePayloadMap[K],
  tempId?: string,
): Promise<void> {
  const payload: StoredOfflinePayload = tempId ? { input, tempId } : { input };
  await getOfflineQueue().enqueue(op, payload);
}

// ── the optimistic running entry ─────────────────────────────────────

/**
 * What a queued start or stop implies about the timer, kept on disk beside the
 * queue itself.
 *
 * {@link cachedRunning} cannot carry this. The worker is evicted after about
 * 30 seconds while the queued mutation outlives it on disk, so a memory-only
 * optimistic entry leaves the revived worker believing nothing is running when
 * an `entries.start` is still waiting to be sent: the badge blanks, the popup
 * offers Start again, and pressing it queues a second start that replays as a
 * duplicate the moment the network returns.
 */
const OPTIMISTIC_RUNNING_KEY = "tracktime.optimistic-running";

let optimisticStore: KeyValueStorage | null = null;

const getOptimisticStore = (): KeyValueStorage => {
  optimisticStore ??= chromeStorage(localStorageArea());
  return optimisticStore;
};

/**
 * `{ entry: null }` is a real state — "a stop is queued" — and is why this is
 * stored as an envelope rather than as a bare nullable entry.
 */
export async function rememberOptimisticRunning(
  entry: TimeEntry | null,
): Promise<void> {
  await getOptimisticStore().setItem(
    OPTIMISTIC_RUNNING_KEY,
    JSON.stringify({ entry }),
  );
}

const forgetOptimisticRunning = async (): Promise<void> => {
  await getOptimisticStore().removeItem(OPTIMISTIC_RUNNING_KEY);
};

const loadOptimisticRunning = async (): Promise<{
  entry: TimeEntry | null;
} | null> => {
  const raw = await getOptimisticStore().getItem(OPTIMISTIC_RUNNING_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { entry } = parsed as { entry?: unknown };
    if (entry === null) return { entry: null };
    if (typeof entry !== "object" || entry === undefined) return null;
    return { entry: entry as TimeEntry };
  } catch {
    // A row from an older build is not worth wedging a cold start over.
    return null;
  }
};

/**
 * Restore the optimistic view on a cold start, but only while the queue that
 * justifies it is still non-empty — a leftover key must never resurrect a
 * timer whose mutation has already been replayed.
 */
const rehydrateOptimisticRunning = async (): Promise<void> => {
  if ((await getOfflineQueue().size()) === 0) {
    await forgetOptimisticRunning();
    return;
  }
  const stored = await loadOptimisticRunning();
  if (stored !== null) cachedRunning = stored;
};

// ── rebuilding ───────────────────────────────────────────────────────

const buildRuntime = async (): Promise<Runtime> => {
  const [apiUrl, stored] = await Promise.all([loadApiUrl(), loadSession()]);

  // The web app's cookie wins when the extension has nothing of its own: that
  // is what makes signing in on the web sign the toolbar in too, with no form
  // and no second credential. A password session, once created, is kept —
  // re-adopting the cookie under it would silently switch which session the
  // user is on.
  let session = stored;
  let sessionSource: SessionSource | null = stored ? "password" : null;

  if (!session) {
    const webToken = await readWebSessionToken(apiUrl);
    if (webToken !== null) {
      session = { token: webToken, userId: null, email: null };
      sessionSource = "web";
    }
  }

  const next: Runtime = {
    apiUrl,
    session,
    sessionSource,
    api: createApiClient({
      baseUrl: apiUrl,
      token: session?.token,
      clientId: EXTENSION_CLIENT_ID,
    }),
  };

  runtime = next;
  // A queued mutation outlives the worker that made it, so the optimistic view
  // of the timer has to come back with it — otherwise a revived worker
  // contradicts a start that is still waiting to be sent.
  if (session !== null) await rehydrateOptimisticRunning();
  connectSync(next);
  return next;
};

/**
 * Rehydrate the worker if it has just been revived, otherwise hand back what
 * is already there. Safe — and cheap — to await from every event handler,
 * which is exactly how it is meant to be used: a handler that skips it will
 * work in testing and fail in the field, because in testing the worker
 * happened to still be warm.
 */
export function ensureReady(): Promise<Runtime> {
  if (runtime) return Promise.resolve(runtime);
  if (building) return building;

  // Two events can wake the worker at once; both must await one build.
  const pending = buildRuntime();
  building = pending;
  return pending.finally(() => {
    if (building === pending) building = null;
  });
}

/**
 * Throw the runtime away and build a fresh one. Used whenever the inputs
 * change under it — a new token, a new API URL — since both are baked into the
 * api client and the socket at construction time.
 */
export async function reload(): Promise<Runtime> {
  closeSync();
  runtime = null;
  cachedRunning = null;
  runningLookup = null;
  cachedProjects = null;
  cachedClients = null;
  cachedTasks = null;
  cachedTodaySec = null;
  cachedWebUrl = null;
  cachedEmail = null;
  return ensureReady();
}

// ── sync socket ──────────────────────────────────────────────────────

const setSyncStatus = (next: SyncStatus): void => {
  if (syncStatus === next) return;
  syncStatus = next;
  if (next !== "open") return;

  // Every event that arrived while the socket was down was delivered to
  // nobody, so the caches this socket is responsible for keeping honest are
  // now suspect. Without this, a timer stopped on another device during a
  // few-second wifi blip keeps counting up here until the worker happens to be
  // evicted — and pressing Stop then fails against a server with nothing
  // running. One `entries.current` per reconnect buys a self-healing gap.
  cachedRunning = null;
  runningLookup = null;
  cachedProjects = null;
  cachedClients = null;
  cachedTasks = null;
  cachedTodaySec = null;

  // A socket that just came up is the first reliable sign the network is back.
  // Nothing awaits this, so it must swallow its own failure — the next
  // reconnect or the next mutation will try the queue again.
  void flushQueue().catch(() => undefined);
};

const closeSync = (): void => {
  sync?.close();
  sync = null;
  setSyncStatus("closed");
};

/**
 * Apply another device's event to the cache.
 *
 * The events carry the entry itself, so nothing here needs a round trip — the
 * badge can be repainted from the message alone, which matters because these
 * arrive while the worker would otherwise be asleep.
 */
const applyEvent = (event: SyncEvent): void => {
  switch (event.kind) {
    case "timer.started":
      cachedRunning = { entry: event.entry };
      return;
    case "timer.stopped":
      cachedRunning = { entry: null };
      return;
    case "entry.upserted":
      if (event.entry.end === null) {
        cachedRunning = { entry: event.entry };
        return;
      }
      // An edit that closed the entry we thought was running stops the timer.
      if (cachedRunning?.entry?.id === event.entry.id) {
        cachedRunning = { entry: null };
      }
      return;
    case "entry.deleted":
      if (cachedRunning?.entry?.id === event.id) cachedRunning = { entry: null };
      return;
    case "catalog.changed":
      if (event.scope === "project") cachedProjects = null;
      if (event.scope === "client") cachedClients = null;
      if (event.scope === "task") cachedTasks = null;
      return;
    case "settings.changed":
      return;
  }
};

const connectSync = (current: Runtime): void => {
  closeSync();
  if (!current.session) return;

  const url = syncUrlFrom(current.apiUrl);
  if (url === "") return;

  sync = createSyncClient({
    url,
    token: current.session.token,
    onStatus: setSyncStatus,
    onEvent: (event, originId) => {
      // Our own write, already applied locally — re-applying a stale copy of
      // it would flicker the badge back to what it was a moment ago.
      if (originId === ORIGIN_ID) return;
      applyEvent(event);
      void renderBadge(cachedRunning?.entry ?? null);
    },
  });
  sync.connect();
};

export const getSyncStatus = (): SyncStatus => syncStatus;

// ── caches ───────────────────────────────────────────────────────────

export const peekRunning = (): TimeEntry | null => cachedRunning?.entry ?? null;

export const setCachedRunning = (entry: TimeEntry | null): void => {
  cachedRunning = { entry };
  runningLookup = null;
};

export const getCachedProjects = (): Project[] | null => cachedProjects;

export const setCachedProjects = (projects: Project[]): void => {
  cachedProjects = projects;
};

export const getCachedTodaySec = (): number | null => cachedTodaySec;

export const setCachedTodaySec = (seconds: number): void => {
  cachedTodaySec = seconds;
};

export const getCachedClients = (): Client[] | null => cachedClients;

export const setCachedClients = (clients: Client[]): void => {
  cachedClients = clients;
};

export const getCachedTasks = (
  projectId: string | null,
): Task[] | null =>
  projectId !== null && cachedTasks?.projectId === projectId
    ? cachedTasks.tasks
    : null;

export const setCachedTasks = (projectId: string, tasks: Task[]): void => {
  cachedTasks = { projectId, tasks };
};

export const getCachedTasksProjectId = (): string | null =>
  cachedTasks?.projectId ?? null;

/**
 * Where the web app lives, asked of the API rather than configured twice.
 *
 * `/api/health` is public, so this works before sign-in — which matters,
 * because "Open tracktime" is exactly what someone with no session wants. A
 * failure is cached as `null` and simply hides the menu item.
 */
/**
 * The signed-in address, from better-auth's own session endpoint.
 *
 * Only ever needed for a cookie-adopted session; a password sign-in already
 * knows it. Returns null rather than throwing — a footer with no address is a
 * cosmetic loss, not a reason to fail the snapshot.
 */
export async function resolveEmail(): Promise<string | null> {
  const current = await ensureReady();
  if (!current.session) return null;
  if (current.session.email !== null) return current.session.email;
  if (cachedEmail !== null) return cachedEmail;

  try {
    const response = await fetch(
      `${current.apiUrl.replace(/\/$/, "")}/api/auth/get-session`,
      { headers: { authorization: `Bearer ${current.session.token}` } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const user =
      typeof body === "object" && body !== null
        ? (body as { user?: { email?: unknown } }).user
        : undefined;
    const email = user?.email;
    if (typeof email !== "string" || email === "") return null;
    cachedEmail = email;
    return email;
  } catch {
    return null;
  }
}

export async function resolveWebUrl(): Promise<string | null> {
  if (cachedWebUrl !== null) return cachedWebUrl;
  const current = await ensureReady();
  try {
    const response = await fetch(
      `${current.apiUrl.replace(/\/$/, "")}/api/health`,
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const webUrl =
      typeof body === "object" && body !== null
        ? (body as { webUrl?: unknown }).webUrl
        : undefined;
    if (typeof webUrl !== "string" || webUrl.trim() === "") return null;
    cachedWebUrl = webUrl.trim();
    return cachedWebUrl;
  } catch {
    return null;
  }
}

/**
 * The running entry, fetched only when the cache has never been filled.
 *
 * After a cold start that is one request; from then on the sync socket keeps
 * the cache honest, so the 30-second badge alarm costs nothing on the wire.
 * The in-flight promise is shared because a wake-up commonly triggers the
 * badge refresh and a popup `state:get` at the same instant.
 */
export async function resolveRunning(): Promise<TimeEntry | null> {
  const current = await ensureReady();
  if (!current.session) return null;
  if (cachedRunning) return cachedRunning.entry;
  if (runningLookup) return runningLookup;

  const lookup = current.api
    .query<TimeEntry | null>("entries.current")
    .then((entry) => {
      cachedRunning = { entry };
      return entry;
    });

  runningLookup = lookup;
  try {
    return await lookup;
  } finally {
    if (runningLookup === lookup) runningLookup = null;
  }
}

// ── session lifecycle ────────────────────────────────────────────────

export async function adoptSession(session: StoredSession): Promise<void> {
  await saveSession(session);
  await reload();
}

/**
 * React to the web app's session cookie appearing or disappearing.
 *
 * Appearing signs the toolbar in, but only if it has no password session of
 * its own to displace. Disappearing signs it out — but only when the session
 * it is holding IS the web one, or signing out of the web app would also kick
 * an unrelated password session that is still perfectly valid.
 */
export async function onWebSessionChanged(token: string | null): Promise<void> {
  const current = await ensureReady();

  if (token === null) {
    if (current.sessionSource !== "web") return;
    await clearSession();
    await reload();
    await renderBadge(null);
    return;
  }

  if (current.sessionSource === "password") return;
  if (current.session?.token === token) return;

  await clearSession();
  await reload();
  await refreshBadgeFromCache();
}

/** Repaint the badge from whatever the rebuilt runtime now knows. */
const refreshBadgeFromCache = async (): Promise<void> => {
  try {
    await renderBadge(await resolveRunning());
  } catch {
    await renderBadge(peekRunning());
  }
};

/**
 * Drop the local token and everything derived from it.
 *
 * Called both on an explicit sign-out and when the server rejects the token.
 * In both cases the token is worthless, and keeping it would only produce more
 * 401s on every subsequent poll.
 */
export async function forgetSession(
  options: { clearWebCookie?: boolean } = {},
): Promise<void> {
  // The queue is only meaningful under the token that authorized it. Replaying
  // one account's queued start under the next account's token would write that
  // work into the wrong account, and `flushQueue` runs on sign-in, on bootstrap
  // and on every socket reconnect — so the rows must not outlive the token.
  await getOfflineQueue().clear();
  await forgetOptimisticRunning();

  // Deliberate on an explicit sign-out: signing out is synced, so the web app's
  // cookie goes too. NOT done when the server merely rejected the token — that
  // is an expired session, and deleting the cookie would sign the web app out
  // of a session it may still be able to refresh.
  if (options.clearWebCookie === true) {
    const current = runtime;
    if (current) await clearWebSessionCookie(current.apiUrl);
  }

  await clearSession();
  await reload();
  await renderBadge(null);
}

// ── error classification ─────────────────────────────────────────────

/** The stored token is no longer good for anything — sign out locally. */
export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.httpStatus === 401 || error.code === "UNAUTHORIZED");

/**
 * True when the request never reached the server, so the mutation is safe to
 * queue and replay later. `ApiError` is only ever thrown once an HTTP response
 * has come back, which makes "not an `ApiError`" a precise test for a
 * transport failure — no message sniffing, unlike the web client, which has to
 * classify tRPC's own error objects.
 */
export const isTransportFailure = (error: unknown): boolean =>
  !(error instanceof ApiError);

// ── replay ───────────────────────────────────────────────────────────

/**
 * Replay whatever was queued while offline, in the order the user performed
 * it, and report how much is still stuck. Stops at the first failure and
 * leaves the rest queued — the queue's own contract — so a start is never
 * replayed after the stop that followed it.
 *
 * Callers use the return value to decide whether a *new* mutation may go out
 * live: sending one ahead of older queued ones would land it out of order, and
 * `entries.stop` in particular resolves against whatever is running at the
 * moment it arrives.
 */
export async function flushQueue(): Promise<number> {
  const current = await ensureReady();
  const offline = getOfflineQueue();
  const pending = await offline.size();
  if (pending === 0) return 0;
  if (!current.session) return pending;

  const result = await offline.flush(async (row) => {
    const decoded = decodeOfflineMutation(row);
    // A row written by an older build cannot be replayed against today's
    // schema; resolving drops it rather than wedging everything behind it.
    if (decoded === null) return;
    // The op string *is* the tRPC path, by design — so there is no dispatch
    // table here to drift out of step with the queue contract.
    await current.api.mutate(decoded.op, decoded.input);
  });

  // Drained: the server now holds everything the optimistic entry stood in for.
  if (result.remaining === 0) await forgetOptimisticRunning();

  if (result.flushed > 0) {
    // Replay moved the server on in ways we never modelled locally; re-read
    // the running entry rather than trust a cache built from optimistic
    // guesses about what each queued mutation would do.
    cachedRunning = null;
    runningLookup = null;
  }
  return result.remaining;
}
