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
  Project,
  SyncStatus,
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
    }
  | { type: "timer:stop" }
  /** Tasks are per-project, so they are fetched when a project is picked. */
  | { type: "tasks:for-project"; projectId: string | null }
  | { type: "client:create"; name: string }
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
  /** Tasks for whichever project the popup last asked about. */
  tasks: Task[];
  /** Which project `tasks` belongs to, so the popup can spot a stale list. */
  tasksProjectId: string | null;
  todaySec: number;
  syncStatus: SyncStatus;
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
