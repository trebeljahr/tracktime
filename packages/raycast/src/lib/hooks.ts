import { useCachedPromise } from "@raycast/utils";
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
