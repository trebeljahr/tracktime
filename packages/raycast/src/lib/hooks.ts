import { useCachedPromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { getTracktime, type Tracktime } from "./api.js";
import { isAuthFailure, showFailureToast } from "./ui.js";

export type ApiHookResult<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  /** True when the failure was "no session", so the caller shows sign-in. */
  signedOut: boolean;
  revalidate: () => void;
};

/**
 * Load something from the API with Raycast's stale-while-revalidate cache, so
 * a command paints last known data immediately instead of a spinner.
 *
 * `cacheKey` namespaces the cached value — two loaders in one command must
 * not share a slot.
 */
export function useApi<T>(
  cacheKey: string,
  loader: (api: Tracktime) => Promise<T>,
  options?: { execute?: boolean },
): ApiHookResult<T> {
  const { data, isLoading, error, revalidate } = useCachedPromise(
    // The key is passed as an argument, not closed over, because that is what
    // `useCachedPromise` hashes into its cache slot.
    async (_key: string): Promise<T> => loader(await getTracktime()),
    [cacheKey],
    {
      execute: options?.execute,
      keepPreviousData: true,
      onError: (failure) => {
        void showFailureToast(failure, "Could not reach tracktime");
      },
    },
  );

  return {
    data,
    isLoading,
    error,
    signedOut: isAuthFailure(error),
    revalidate,
  };
}

/**
 * Re-run a loader on a timer, for a surface that has to notice a change it
 * did not make itself.
 *
 * Every tracktime client refreshes the menu bar after its own mutations, so
 * this is only about the ones that cannot: a timer started in the web app, on
 * another machine, or by a build of this extension that is not running.
 */
export function usePoll(revalidate: () => void, intervalMs: number): void {
  useEffect(() => {
    const id = setInterval(revalidate, intervalMs);
    return () => clearInterval(id);
  }, [revalidate, intervalMs]);
}

/**
 * Watch for the running entry being replaced or stopped, and reload when it
 * is.
 *
 * A surface that stays loaded to count seconds has to answer for those
 * seconds: nothing re-runs it any more, so a timer stopped anywhere else
 * leaves a clock ticking up on an entry that already ended — a wrong number,
 * not merely a stale one. `entries.current` is one small query, so this can
 * run far more often than the full snapshot and hand the reload to it only
 * once the two disagree.
 *
 * Failures are swallowed. The menu bar has no good place to put a network
 * blip, and the next tick asks again anyway.
 */
export function useWatchRunning(
  runningId: string | null,
  active: boolean,
  revalidate: () => void,
  intervalMs: number,
): void {
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const api = await getTracktime();
        const current = await api.current();
        if (!cancelled && (current?.id ?? null) !== runningId) revalidate();
      } catch {
        // Asked again on the next tick.
      }
    };

    const id = setInterval(() => void check(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runningId, active, revalidate, intervalMs]);
}

/**
 * A clock that re-renders its caller, so an elapsed time on screen actually
 * moves.
 *
 * Frozen while `active` is false: with no timer running there is nothing to
 * count, and a view command that wakes every second to render the same string
 * is a battery cost with no payoff. Re-reads the clock on activation so a
 * timer started a moment ago does not wait a full tick to show up.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
