"use client";

import * as React from "react";

import { trpc } from "@/lib/trpc";
import {
  flushOfflineQueue,
  getPendingCount,
  getServerPendingCount,
  isNetworkError,
  isOnline,
  refreshPendingCount,
  subscribePending,
  type OfflineMutation,
} from "@/lib/offline";
import { useSyncStatus } from "@/hooks/use-sync";
import {
  replayOfflineMutation,
  type OfflineReplayMutators,
} from "@/hooks/replay-offline-mutation";
import { idleWatcher } from "@/lib/idle-watcher";

export type OfflineQueueState = {
  /** Number of mutations waiting to reach the server. */
  pending: number;
  online: boolean;
  isFlushing: boolean;
  /** Replay the queue now. Safe to call when it is empty or already running. */
  flush: () => Promise<void>;
};

// ── online/offline, as an external store ─────────────────────────────

type Listener = () => void;

const onlineListeners = new Set<Listener>();
let onlineBound = false;

const notifyOnline = (): void => {
  for (const listener of onlineListeners) listener();
};

const subscribeOnline = (listener: Listener): (() => void) => {
  onlineListeners.add(listener);
  if (!onlineBound && typeof window !== "undefined") {
    onlineBound = true;
    window.addEventListener("online", notifyOnline);
    window.addEventListener("offline", notifyOnline);
  }
  return () => {
    onlineListeners.delete(listener);
  };
};

const getOnline = (): boolean => isOnline();
const getServerOnline = (): boolean => true;

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
    subscribeOnline,
    getOnline,
    getServerOnline
  );

  const [isFlushing, setIsFlushing] = React.useState(false);

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
    async (mutation: OfflineMutation): Promise<void> =>
      replayOfflineMutation(mutators, idleWatcher, mutation),
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

    try {
      const result = await flushOfflineQueue(async (mutation) => {
        try {
          await dispatchRef.current(mutation);
          applied += 1;
        } catch (error) {
          // Still unreachable — stop here so the rest keeps its order.
          if (isNetworkError(error)) throw error;
          // The server refused it. The server wins: drop the mutation and
          // let the invalidation below pull the authoritative state back.
          rejected += 1;
        }
      });

      if (applied > 0 || rejected > 0 || result.flushed > 0) {
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

    const handleOnline = (): void => {
      void flushRef.current();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // The socket reopening is the earliest reliable "we are back" signal —
  // earlier than the next user action, and more trustworthy than navigator.
  React.useEffect(() => {
    if (syncStatus !== "open") return;
    void flushRef.current();
  }, [syncStatus]);

  return { pending, online, isFlushing, flush };
};
