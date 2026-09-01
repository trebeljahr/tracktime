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
import type { Project, SyncStatus, TimeEntry } from "@starter/core";

export type PopupToBackground =
  | { type: "state:get" }
  | { type: "auth:sign-in"; email: string; password: string }
  | { type: "auth:sign-out" }
  | { type: "timer:start"; description: string; projectId: string | null }
  | { type: "timer:stop" }
  | { type: "config:set-api-url"; apiUrl: string };

export type BackgroundState = {
  apiUrl: string;
  signedIn: boolean;
  email: string | null;
  running: TimeEntry | null;
  projects: Project[];
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
