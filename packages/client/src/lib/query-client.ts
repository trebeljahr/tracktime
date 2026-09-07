"use client";

import { QueryClient, onlineManager } from "@tanstack/react-query";

import { isAuthError } from "@/lib/offline";
import { isNative } from "@/mobile/bridge";
import { getNetworkOnline, subscribeNetwork } from "@/mobile/network";

/**
 * React Query, configured for the host it is running on.
 *
 * Three decisions, each of which has a wrong answer that looks fine until the
 * network goes away:
 *
 * **`onlineManager` is fed the radio, not the browser.** Its default listener
 * is `window.online`/`offline`, which in WKWebView never fires for airplane
 * mode. With the wrong verdict every query on a backgrounded phone wakes up
 * and fires into a radio that is not there.
 *
 * **Mutations run in `networkMode: "always"`.** This one is not a preference.
 * React Query's default is to *pause* a mutation while `onlineManager` says
 * offline: `mutationFn` never runs, `onError` never fires, and this app queues
 * offline work from `onError` (`components/tracker/use-entry-mutations.ts`).
 * Paused means the promise sits there and nothing is ever queued — the timer
 * button would simply do nothing in airplane mode. The offline queue *is* this
 * app's pause mechanism, and it needs the failure to happen to do its job.
 * (Queries keep the default `"online"`, where pausing is exactly right: there
 * is nothing to preserve in a read that cannot be made.)
 *
 * **Retries are bounded on native.** The web defaults (3 attempts, exponential
 * backoff) are fine on a desktop; on a phone they are a battery cost paid per
 * screen per wake. An `UNAUTHORIZED` is never retried on either platform —
 * retrying a session the server has rejected cannot change its mind.
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
      mutations: {
        networkMode: "always",
      },
    },
  });
};

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
