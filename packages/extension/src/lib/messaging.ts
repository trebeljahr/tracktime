/**
 * The one channel between the popup and the service worker.
 *
 * The worker owns everything stateful — the session token, the api-client,
 * the sync socket, the offline queue. The popup is a renderer: it sends a
 * message and gets a full {@link BackgroundState} snapshot back. Snapshots
 * are whole, never partial, so the popup never merges — it just re-renders.
 * That matters because the popup is destroyed every time it closes, and a
 * half-applied patch would be indistinguishable from a stale one.
 */
import type {
  Client,
  DetailedFavorite,
  IdleAnswer,
  PendingIdle,
  Project,
  QuickStart,
  QuickStartItem,
  RecentEntry,
  SyncStatus,
  Tag,
  Task,
  TimeEntry,
} from "@starter/core";

export type PopupToBackground =
  | { type: "state:get" }
  | { type: "auth:sign-in"; email: string; password: string }
  | { type: "auth:sign-out" }
  | {
      type: "timer:start";
      description: string;
      projectId: string | null;
      taskId: string | null;
      /**
       * Omitted falls back to the picked project's `billableDefault`, which is
       * what the popup's own form wants. A quick start sends it explicitly:
       * the flag was decided when the favorite was pinned, or when the recent
       * entry was originally tracked, and re-deriving it here would silently
       * change what a pin means.
       */
      billable?: boolean;
      /**
       * Tags to open the entry with. A quick start passes the ones the
       * favorite or the recent already carries, for the same reason it passes
       * `billable` — they are part of what is being repeated.
       */
      tagIds?: string[];
    }
  | { type: "timer:stop" }
  /**
   * Edit the entry that is currently running.
   *
   * Every field is optional and absent means "leave it alone", which is the
   * same contract `entries.update` has server-side — so a patch queued offline
   * replays as exactly the edit that was made, not as a whole-entry overwrite
   * that would clobber a change some other device made in between.
   *
   * The entry is named by the worker rather than the popup: the popup's copy of
   * the running entry can be a few seconds stale, and an id from a snapshot
   * taken before another device stopped the timer would edit the wrong row.
   */
  | {
      type: "timer:update";
      description?: string;
      projectId?: string | null;
      taskId?: string | null;
      billable?: boolean;
      /** Replaces the whole set; `[]` clears it. */
      tagIds?: string[];
    }
  /** Pin the given combination. Idempotent — pinning twice is one pin. */
  | { type: "favorite:add"; quick: QuickStart }
  | { type: "favorite:remove"; id: string }
  /** The user's answer to the idle prompt the popup is showing. */
  | { type: "idle:answer"; answer: IdleAnswer }
  /** Tasks are per-project, so they are fetched when a project is picked. */
  | { type: "tasks:for-project"; projectId: string | null }
  | { type: "client:create"; name: string }
  | { type: "tag:create"; name: string }
  | { type: "project:create"; name: string; clientId: string | null }
  | { type: "task:create"; projectId: string; name: string }
  | { type: "config:set-api-url"; apiUrl: string };

/**
 * Where the current session came from.
 *
 * `web` means it was adopted from the web app's cookie, which is what makes
 * signing in on one side sign in on the other. The popup shows this, because
 * "sign out" means something different depending on it: on a shared session it
 * signs the web app out too.
 */
export type SessionSource = "web" | "password";

export type BackgroundState = {
  apiUrl: string;
  /** Where "Open tracktime" goes. Discovered from the API's /api/health. */
  webUrl: string | null;
  signedIn: boolean;
  sessionSource: SessionSource | null;
  email: string | null;
  running: TimeEntry | null;
  projects: Project[];
  clients: Client[];
  /** Every unarchived tag — tags are not scoped to a project. */
  tags: Tag[];
  /** Tasks for whichever project the popup last asked about. */
  tasks: Task[];
  /** Which project `tasks` belongs to, so the popup can spot a stale list. */
  tasksProjectId: string | null;
  /**
   * The quick-start row: pins first, then recents, already merged.
   *
   * Merged in the worker rather than the popup because the worker owns all
   * state, and because the merge rule — a recent that is already pinned is
   * dropped — has to match what the web app shows or the same browser
   * disagrees with itself.
   */
  quickStarts: QuickStartItem[];
  /** The pins alone, so the popup can tell what unpinning would remove. */
  favorites: DetailedFavorite[];
  /** The derived tier, kept separate so a stale merge can be recomputed. */
  recents: RecentEntry[];
  todaySec: number;
  /** The live-update socket alone — see {@link BackgroundState.serverReachable}. */
  syncStatus: SyncStatus;
  /**
   * Whether the server answered the last read that reached a verdict.
   *
   * Reported separately from `syncStatus` because the two really are separate,
   * and collapsing them is what made a working toolbar say "Offline": every
   * read and write goes over plain HTTP, which keeps working when the
   * WebSocket upgrade is the only thing that failed. In that state the popup
   * is behind on other devices' changes, but nothing the user does here is
   * lost — a very different thing to tell them.
   */
  serverReachable: boolean;
  /** Mutations waiting to be replayed. Zero on a healthy connection. */
  pendingSync: number;
  /**
   * An idle span waiting to be explained, or null.
   *
   * The service worker has no UI, so with the `ask` behaviour it detects the
   * idleness, leaves the timer running and parks the question here for
   * whenever the popup is next opened. Nothing is discarded in the meantime.
   */
  pendingIdle: PendingIdle | null;
};

export type BackgroundResponse =
  | { ok: true; state: BackgroundState }
  | { ok: false; code: string; message: string };

const errorResponse = (code: string, message: string): BackgroundResponse => ({
  ok: false,
  code,
  message,
});

/**
 * Send one message and always resolve.
 *
 * An MV3 worker can be asleep, mid-restart, or throw before it replies, and
 * `chrome.runtime.sendMessage` surfaces all of that as a rejection or an
 * undefined response. Rejecting into the caller would leave the popup blank;
 * an `{ ok: false }` gives it something to render.
 */
export async function sendToBackground(
  message: PopupToBackground,
): Promise<BackgroundResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);

    // A worker that died before responding yields undefined, not an error.
    if (typeof response !== "object" || response === null) {
      return errorResponse(
        "NO_RESPONSE",
        "The extension background worker did not respond. Try again.",
      );
    }
    return response as BackgroundResponse;
  } catch (error) {
    return errorResponse(
      "PORT_CLOSED",
      error instanceof Error ? error.message : "Could not reach the extension.",
    );
  }
}
