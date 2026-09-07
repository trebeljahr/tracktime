"use client";

import * as React from "react";

import { toast } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc";
import {
  flushOfflineQueue,
  getPendingCount,
  getServerPendingCount,
  isAuthError,
  isNetworkError,
  isOnline,
  refreshPendingCount,
  subscribePending,
  type OfflineMutation,
} from "@/lib/offline";
import { useSyncStatus } from "@/hooks/use-sync";
import {
  replayOfflineMutation,
  StaleQueuedStopError,
  type OfflineReplayMutators,
  type ReplayIdMap,
} from "@/hooks/replay-offline-mutation";
import { idleWatcher } from "@/lib/idle-watcher";
import {
  getServerNetworkOnline,
  subscribeNetwork,
} from "@/mobile/network";

export type OfflineQueueState = {
  /** Number of mutations waiting to reach the server. */
  pending: number;
  online: boolean;
  isFlushing: boolean;
  /**
   * The queue stopped because the server does not recognise this client's
   * session. Nothing was dropped — the rows are still there and will replay
   * after a sign-in.
   */
  authBlocked: boolean;
  /** Replay the queue now. Safe to call when it is empty or already running. */
  flush: () => Promise<void>;
};

// ── online/offline, as an external store ─────────────────────────────

/*
 * The window `online`/`offline` events were the whole story here. They are
 * still the story in a browser, but in WKWebView they do not fire for airplane
 * mode and `navigator.onLine` lies about the radio, so the subscription now
 * goes through `mobile/network.ts` — which listens to the OS on native and to
 * exactly these two events everywhere else.
 */
const getOnline = (): boolean => isOnline();

/**
 * The pending-mutation queue, wired to the things that mean "the network is
 * back": the browser's `online` event and the sync socket reopening. A flush
 * replays in order and stops at the first mutation that still cannot reach the
 * server, so ordering is never broken by a partial retry.
 */
export const useOfflineQueue = (): OfflineQueueState => {
  const utils = trpc.useUtils();
  const syncStatus = useSyncStatus();

  const pending = React.useSyncExternalStore(
    subscribePending,
    getPendingCount,
    getServerPendingCount
  );
  const online = React.useSyncExternalStore(
    subscribeNetwork,
    getOnline,
    getServerNetworkOnline
  );

  const [isFlushing, setIsFlushing] = React.useState(false);
  const [authBlocked, setAuthBlocked] = React.useState(false);

  const startMutation = trpc.entries.start.useMutation();
  const stopMutation = trpc.entries.stop.useMutation();
  const createMutation = trpc.entries.create.useMutation();
  const updateMutation = trpc.entries.update.useMutation();
  const removeMutation = trpc.entries.remove.useMutation();
  const discardMutation = trpc.entries.discard.useMutation();

  const mutators: OfflineReplayMutators = React.useMemo(
    () => ({
      "entries.start": (input) => startMutation.mutateAsync(input),
      "entries.stop": (input) => stopMutation.mutateAsync(input),
      "entries.create": (input) => createMutation.mutateAsync(input),
      "entries.update": (input) => updateMutation.mutateAsync(input),
      "entries.remove": (input) => removeMutation.mutateAsync(input),
      "entries.discard": (input) => discardMutation.mutateAsync(input),
    }),
    [
      startMutation,
      stopMutation,
      createMutation,
      updateMutation,
      removeMutation,
      discardMutation,
    ]
  );

  const dispatch = React.useCallback(
    // `idleWatcher` is the tab's module singleton, so it is stable across
    // renders and deliberately not a dependency.
    async (
      mutation: OfflineMutation,
      context: { createdAt: string; resolved: ReplayIdMap }
    ): Promise<void> =>
      replayOfflineMutation(mutators, idleWatcher, mutation, context),
    [mutators]
  );

  // Listeners are registered once; they read the latest dispatch through refs
  // so a re-render never rebinds the window events mid-flush.
  const dispatchRef = React.useRef(dispatch);
  const utilsRef = React.useRef(utils);
  const runningRef = React.useRef(false);

  React.useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  React.useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  const flush = React.useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    if ((await refreshPendingCount()) === 0) return;
    if (!isOnline()) return;

    runningRef.current = true;
    setIsFlushing(true);

    let applied = 0;
    let rejected = 0;
    let stale = 0;
    let blocked = false;

    // One map for the whole flush: a start and the stop that ends it are
    // queued as a pair, and the stop becomes targetable the instant the start
    // ahead of it lands.
    const resolved: ReplayIdMap = new Map();

    try {
      const result = await flushOfflineQueue(async (mutation, meta) => {
        try {
          await dispatchRef.current(mutation, {
            createdAt: meta.createdAt,
            resolved,
          });
          applied += 1;
        } catch (error) {
          // Still unreachable — stop here so the rest keeps its order.
          if (isNetworkError(error)) throw error;
          // A stop from days ago that names no entry. Dropping it is right —
          // it would otherwise end whatever is running now — but it is the
          // user's tracked time, so it is said out loud rather than binned.
          if (error instanceof StaleQueuedStopError) {
            stale += 1;
            return;
          }
          // The session is gone (expired, or signed out from another device).
          // Also a stop, not a drop: the request arrived, but "we do not know
          // who you are" is no verdict on the user's tracked time. Throwing
          // leaves this row and everything behind it in the queue — see
          // `createOfflineQueue.flush`, which writes the remainder back.
          if (isAuthError(error)) {
            blocked = true;
            throw error;
          }
          // The server refused it on the merits (validation, a workspace the
          // user has left). The server wins: drop the mutation and let the
          // invalidation below pull the authoritative state back.
          rejected += 1;
        }
      });

      setAuthBlocked(blocked);

      /*
       * Say something when a row is lost.
       *
       * Both counters mean "the user tracked this and it is not going to
       * exist". Silently deleting somebody's time and then invalidating the
       * caches so the day looks emptier than they remember is the worst
       * possible way to handle it.
       */
      if (rejected > 0) {
        toast.error(
          rejected === 1
            ? "One offline change could not be saved"
            : `${rejected} offline changes could not be saved`,
          { description: "The server refused them, so they were discarded." }
        );
      }
      if (stale > 0) {
        toast.error(
          stale === 1
            ? "An old entry could not be closed"
            : `${stale} old entries could not be closed`,
          {
            description:
              "A stop queued more than a day ago no longer names an entry we can safely end. Check the timer and stop it by hand.",
          }
        );
      }

      if (applied > 0 || rejected > 0 || stale > 0 || result.flushed > 0) {
        await utilsRef.current.entries.invalidate();
        await utilsRef.current.reports.invalidate();
      }
    } finally {
      runningRef.current = false;
      setIsFlushing(false);
    }
  }, []);

  const flushRef = React.useRef(flush);
  React.useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  React.useEffect(() => {
    void refreshPendingCount();

    // Through `subscribeNetwork` rather than `window.addEventListener("online")`
    // so this fires when a phone leaves airplane mode, which WKWebView does not
    // report as an `online` event at all.
    return subscribeNetwork(() => {
      if (!isOnline()) return;
      void flushRef.current();
    });
  }, []);

  // The socket reopening is the earliest reliable "we are back" signal —
  // earlier than the next user action, and more trustworthy than navigator.
  React.useEffect(() => {
    if (syncStatus !== "open") return;
    void flushRef.current();
  }, [syncStatus]);

  // `authBlocked` is only ever reassigned by a flush that reaches its own
  // `setAuthBlocked`, so a queue drained by any other path (a successful
  // mutation clearing the last row, a sign-out that resets it) would leave the
  // flag stuck true and the tracker bar accusing a signed-in user. Nothing is
  // blocked when nothing is queued, so derive it rather than tracking it.
  return { pending, online, isFlushing, authBlocked: authBlocked && pending > 0, flush };
};
