"use client";

import { QueryClient, onlineManager } from "@tanstack/react-query";

import { isAuthError } from "@/lib/offline";
import { isNative } from "@/mobile/bridge";
import { getNetworkOnline, subscribeNetwork } from "@/mobile/network";

/**
 * React Query, configured for the host it is running on.
 *
 * Two decisions, each of which has a wrong answer that looks fine until the
 * network goes away:
 *
 * **`onlineManager` is fed the radio, not the browser.** Its default listener
 * is `window.online`/`offline`, which in WKWebView never fires for airplane
 * mode. With the wrong verdict every query on a backgrounded phone wakes up
 * and fires into a radio that is not there.
 *
 * **Retries are bounded on native.** The web defaults (3 attempts, exponential
 * backoff) are fine on a desktop; on a phone they are a battery cost paid per
 * screen per wake. An `UNAUTHORIZED` is never retried on either platform —
 * retrying a session the server has rejected cannot change its mind.
 *
 * Mutations keep React Query's defaults here, `networkMode: "online"`
 * included. See `OFFLINE_QUEUED_MUTATION` below for the handful that must
 * not.
 */
export const createAppQueryClient = (): QueryClient => {
  const native = isNative();

  return new QueryClient({
    defaultOptions: {
      queries: native
        ? {
            retry: (failureCount: number, error: unknown) => {
              if (isAuthError(error)) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt: number) =>
              Math.min(1000 * 2 ** attempt, 30_000),
          }
        : {},
    },
  });
};

/**
 * The mutation options for a write the offline queue owns.
 *
 * React Query's default is to *pause* a mutation while `onlineManager` says
 * offline: `mutationFn` never runs, `onError` never fires, and the offline
 * queue is filled from `onError`. Paused means the promise sits there and
 * nothing is ever queued — the timer button would simply do nothing in
 * airplane mode. The offline queue *is* the pause mechanism for these writes,
 * and it needs the failure to happen to do its job.
 *
 * **Applied per mutation, deliberately not as a `defaultOptions.mutations`.**
 * It used to be global, which quietly took React Query's pause-and-resume away
 * from every *other* mutation in the app — profile edits, catalog renames,
 * invoice writes, the calendar's drag-to-move — on the web as much as on the
 * phone. None of those queue anything: without pausing they roll back and
 * toast "network error" the instant the connection blips, where pausing would
 * have replayed them on reconnect with the optimistic state intact. Three
 * places need this and they are the three that catch the failure:
 *
 *  - `components/tracker/use-entry-mutations.ts` — start/stop/create/edit
 *  - `components/timesheet/use-timesheet-mutations.ts` — the grid's writes
 *  - `hooks/use-offline-queue.ts` — the replay itself, which must reject
 *    rather than hang if the radio dies mid-flush; a paused replay would
 *    leave `flush()` awaiting a promise that never settles and the queue
 *    latched as "flushing" for the rest of the launch.
 *
 * Adding a fourth is a decision to argue about, not a default to inherit.
 */
export const OFFLINE_QUEUED_MUTATION = {
  networkMode: "always",
} as const;

let bound = false;

/**
 * Hand React Query the same network verdict everything else in the app uses.
 * Idempotent; `setEventListener` replaces whatever was registered before, and
 * calling it twice would leave a dangling subscription.
 */
export const bindOnlineManager = (): void => {
  if (bound) return;
  bound = true;

  onlineManager.setEventListener((setOnline) => {
    setOnline(getNetworkOnline());
    return subscribeNetwork(() => setOnline(getNetworkOnline()));
  });
};
