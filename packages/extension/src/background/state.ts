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
import type { ApiClient, Project, TimeEntry } from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import {
  ensureReady,
  forgetSession,
  getCachedProjects,
  getCachedTodaySec,
  getSyncStatus,
  isUnauthorized,
  peekRunning,
  resolveRunning,
  setCachedProjects,
  setCachedTodaySec,
} from "./runtime";

/** Today's entries could plausibly run to a few dozen; 500 is the cap. */
const TODAY_ENTRY_LIMIT = 500;

const signedOutState = (apiUrl: string): BackgroundState => ({
  apiUrl,
  signedIn: false,
  email: null,
  running: null,
  projects: [],
  todaySec: 0,
  syncStatus: getSyncStatus(),
});

const fetchProjects = async (api: ApiClient): Promise<Project[]> => {
  const projects = await api.query<Project[]>("projects.list", {
    includeArchived: false,
  });
  setCachedProjects(projects);
  return projects;
};

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
  if (!current.session) return signedOutState(current.apiUrl);

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

  const running = await softRead(resolveRunning, peekRunning());
  const [projects, todaySec] = await Promise.all([
    softRead(() => fetchProjects(current.api), getCachedProjects() ?? []),
    softRead(() => fetchTodaySec(current.api), getCachedTodaySec() ?? 0),
  ]);

  if (unauthorized) {
    // The token was revoked from Settings → Devices, or it simply expired.
    // Clearing it locally is what makes the popup offer sign-in again instead
    // of looping on an error the user cannot act on.
    await forgetSession();
    return signedOutState(current.apiUrl);
  }

  return {
    apiUrl: current.apiUrl,
    signedIn: true,
    email: current.session.email,
    running,
    projects,
    todaySec,
    syncStatus: getSyncStatus(),
  };
}
