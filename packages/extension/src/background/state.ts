/**
 * Building the {@link BackgroundState} snapshot the popup renders.
 *
 * Snapshots are always whole. The popup is destroyed every time it closes, so
 * it has no baseline to merge a partial update onto — a half-applied patch
 * would be indistinguishable from a stale one.
 *
 * Two failure modes are handled differently on purpose. A 401 means the token
 * is dead and the popup must be told to show its sign-in form. Anything else —
 * realistically, the network being off — falls back to whatever the worker
 * last knew, because a popup showing a stale running timer is far more useful
 * than one showing an error.
 */
import { mergeQuickStarts, type ApiClient, type TimeEntry } from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import { fetchClients, fetchProjects, fetchTags, fetchTasks } from "./catalog";
import { fetchFavorites, fetchRecents } from "./favorites";
import { pendingIdle } from "./idle-state";
import {
  ensureReady,
  forgetSession,
  getCachedClients,
  getCachedFavorites,
  getCachedProjects,
  getCachedTags,
  getCachedRecents,
  getCachedTasks,
  getCachedTasksProjectId,
  getCachedTodaySec,
  getSyncStatus,
  isUnauthorized,
  peekRunning,
  resolveEmail,
  resolveRunning,
  resolveWebUrl,
  setCachedTodaySec,
} from "./runtime";

/** Today's entries could plausibly run to a few dozen; 500 is the cap. */
const TODAY_ENTRY_LIMIT = 500;

/**
 * How many chips the popup's quick-start row shows. Lower than the web app's:
 * the popup is 360px wide, and a row that scrolls sideways is worse than a
 * short one.
 */
const QUICK_START_LIMIT = 5;

const signedOutState = (
  apiUrl: string,
  webUrl: string | null,
): BackgroundState => ({
  apiUrl,
  webUrl,
  signedIn: false,
  sessionSource: null,
  email: null,
  running: null,
  projects: [],
  clients: [],
  tags: [],
  tasks: [],
  tasksProjectId: null,
  quickStarts: [],
  favorites: [],
  recents: [],
  todaySec: 0,
  syncStatus: getSyncStatus(),
  pendingIdle: null,
});

/**
 * Seconds tracked today in *finished* entries, clamped to the local calendar
 * day.
 *
 * `entries.list` returns everything that *overlaps* the window, so an entry
 * that began before midnight — the overnight session, the timer nobody
 * stopped — would otherwise credit yesterday's hours to today. Clamping both
 * ends to the day boundary is what the reports screen does; the two have to
 * agree or the popup looks broken next to the web app.
 *
 * The running entry is skipped on purpose. The server's list matcher includes
 * it (`{ $or: [{ end: null }, ...] }`), and the popup adds its live elapsed
 * seconds on top of this figure — counting it here too made "Today" tick at
 * double speed for as long as a timer ran.
 */
const fetchTodaySec = async (
  api: ApiClient,
  nowMs: number = Date.now(),
): Promise<number> => {
  const now = new Date(nowMs);
  // Constructed from Y/M/D rather than by adding 24h, so a DST day is still
  // one calendar day.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const page = await api.query<{ entries: TimeEntry[] }>("entries.list", {
    from: dayStart.toISOString(),
    to: dayEnd.toISOString(),
    limit: TODAY_ENTRY_LIMIT,
  });

  const seconds = page.entries.reduce((total, entry) => {
    if (entry.end === null) return total;
    const startMs = Date.parse(entry.start);
    const endMs = Date.parse(entry.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return total;

    const from = Math.max(startMs, dayStart.getTime());
    const to = Math.min(endMs, dayEnd.getTime());
    return to > from ? total + Math.floor((to - from) / 1000) : total;
  }, 0);

  setCachedTodaySec(seconds);
  return seconds;
};

export async function buildState(): Promise<BackgroundState> {
  const current = await ensureReady();
  // Resolved even when signed out: "Open tracktime" is exactly what someone
  // with no session reaches for, so the menu must work before sign-in.
  const webUrl = await resolveWebUrl();
  if (!current.session) return signedOutState(current.apiUrl, webUrl);

  // Set by any read that came back 401. Collected rather than thrown so the
  // reads below can settle instead of leaving sibling rejections unhandled.
  let unauthorized = false;

  const softRead = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      if (isUnauthorized(error)) unauthorized = true;
      return fallback;
    }
  };

  // Whichever project the popup last asked about — carried through so a
  // rebuild of the snapshot does not silently empty the task picker under it.
  const tasksProjectId = getCachedTasksProjectId();

  const running = await softRead(resolveRunning, peekRunning());
  const [
    email,
    projects,
    clients,
    tags,
    tasks,
    todaySec,
    favorites,
    recents,
    idle,
  ] = await Promise.all([
    softRead(resolveEmail, current.session.email),
    softRead(() => fetchProjects(current.api), getCachedProjects() ?? []),
    softRead(() => fetchClients(current.api), getCachedClients() ?? []),
    softRead(() => fetchTags(current.api), getCachedTags() ?? []),
    softRead(
      () => fetchTasks(current.api, tasksProjectId),
      getCachedTasks(tasksProjectId) ?? [],
    ),
    softRead(() => fetchTodaySec(current.api), getCachedTodaySec() ?? 0),
    softRead(() => fetchFavorites(current.api), getCachedFavorites() ?? []),
    softRead(() => fetchRecents(current.api), getCachedRecents() ?? []),
    softRead(pendingIdle, null),
  ]);

  if (unauthorized) {
    // The token was revoked from Settings → Devices, or it simply expired.
    // Clearing it locally is what makes the popup offer sign-in again instead
    // of looping on an error the user cannot act on. The web app's cookie is
    // left alone: an expired token is not a request to sign the browser out.
    await forgetSession();
    return signedOutState(current.apiUrl, webUrl);
  }

  return {
    apiUrl: current.apiUrl,
    webUrl,
    signedIn: true,
    sessionSource: current.sessionSource,
    email,
    running,
    projects,
    clients,
    tags,
    tasks,
    tasksProjectId,
    // Merged here rather than in the popup: the worker owns all state, and
    // the merge rule has to match the web app's or one browser disagrees
    // with itself about what is pinned.
    quickStarts: mergeQuickStarts({
      favorites,
      recents,
      limit: QUICK_START_LIMIT,
    }),
    favorites,
    recents,
    todaySec,
    syncStatus: getSyncStatus(),
    // Dropped once the entry it refers to is no longer the running one: the
    // question "what were those 40 minutes?" is meaningless against an entry
    // somebody has since stopped, and answering it would edit the wrong row.
    pendingIdle: idle !== null && idle.entryId === running?.id ? idle : null,
  };
}
