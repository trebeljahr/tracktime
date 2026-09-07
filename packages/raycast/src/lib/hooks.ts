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
