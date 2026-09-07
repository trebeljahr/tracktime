"use client";

import * as React from "react";
import {
  createId,
  createSyncClient,
  createTimerStore,
  resolveSyncUrl,
  startTicking,
  type SyncEvent,
  type SyncStatus,
  type TimeEntry,
  type TimerState,
} from "@starter/core";
import { idleWatcher } from "@/lib/idle-watcher";
import { trpc } from "@/lib/trpc";

/**
 * Per-tab identity echoed back on every SyncEvent this tab caused, so the
 * originating tab can skip its own broadcast instead of invalidating caches
 * it has already updated.
 */
export const ORIGIN_ID: string = createId();

// ── connection status, shared by every consumer ──────────────────────

type Listener = () => void;

let currentStatus: SyncStatus = "closed";
const statusListeners = new Set<Listener>();

const setStatus = (next: SyncStatus): void => {
  if (next === currentStatus) return;
  currentStatus = next;
  for (const listener of statusListeners) listener();
};

const subscribeStatus = (listener: Listener): (() => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

const getStatus = (): SyncStatus => currentStatus;
const getServerStatus = (): SyncStatus => "closed";

/** The live WebSocket status. Safe to call from anywhere under the shell. */
export const useSyncStatus = (): SyncStatus =>
  React.useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);

// ── URL derivation ───────────────────────────────────────────────────

/** Lives in `@starter/core` so non-React clients derive the same socket URL. */
export { resolveSyncUrl } from "@starter/core";

// ── cache invalidation ───────────────────────────────────────────────

type Utils = ReturnType<typeof trpc.useUtils>;

/**
 * Map a sync event onto the query caches it invalidates. Reports depend on
 * both entries and the catalog, so they are refreshed by either.
 */
const invalidateFor = (utils: Utils, event: SyncEvent): void => {
  switch (event.kind) {
    case "entry.upserted":
    case "entry.deleted":
    case "timer.started":
    case "timer.stopped":
      void utils.entries.invalidate();
      void utils.reports.invalidate();
      return;
    case "catalog.changed":
      void utils.clients.invalidate();
      void utils.projects.invalidate();
      void utils.tasks.invalidate();
      void utils.tags.invalidate();
      void utils.reports.invalidate();
      // A cascading delete rewrites the entries it detached, and publishes no
      // entry event of its own.
      if (event.entriesTouched) void utils.entries.invalidate();
      return;
    case "favorites.changed":
      void utils.favorites.invalidate();
      return;
    case "invoice.changed":
      // Invoicing stamps `invoiceId` onto the entries it bills, so a write
      // here changes what is still billable — entries and reports go stale
      // alongside the ledger itself.
      void utils.invoices.invalidate();
      void utils.entries.invalidate();
      void utils.reports.invalidate();
      return;
    case "settings.changed":
      void utils.settings.invalidate();
      return;
    case "data.imported":
      // An import writes thousands of entries and the catalog behind them in
      // one go, so there is nothing here to patch — every list is refetched,
      // including the import history the undo button reads.
      void utils.entries.invalidate();
      void utils.reports.invalidate();
      void utils.clients.invalidate();
      void utils.projects.invalidate();
      void utils.tasks.invalidate();
      void utils.tags.invalidate();
      void utils.data.invalidate();
      return;
    default: {
      // A new SyncEvent kind with no case here would otherwise be a silent
      // cross-device staleness bug that no test catches. Fail the BUILD
      // instead: this line stops compiling the moment the union grows.
      const unhandled: never = event;
      void unhandled;
      return;
    }
  }
};

/**
 * Opens the sync socket and keeps react-query in step with mutations made on
 * other devices. Mount exactly once, in the app shell.
 */
export const useSync = (): SyncStatus => {
  const utils = trpc.useUtils();
  const utilsRef = React.useRef(utils);

  React.useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  React.useEffect(() => {
    const url = resolveSyncUrl(
      process.env.NEXT_PUBLIC_API_URL ?? "",
      window.location.origin
    );
    if (url === "") return;

    const client = createSyncClient({
      url,
      onStatus: setStatus,
      onEvent: (event, originId) => {
        // Our own echo — the mutation's optimistic update already landed.
        if (originId !== undefined && originId === ORIGIN_ID) return;
        // Somebody just did something on another device, so the person was at
        // a keyboard at this instant. Idle detection measures from here rather
        // than from the last time *this* tab saw input — that is what stops a
        // laptop left open from pausing work being done elsewhere.
        idleWatcher.noteRemoteActivity(Date.now());
        invalidateFor(utilsRef.current, event);
      },
    });

    client.connect();
    return () => {
      client.close();
    };
  }, []);

  return useSyncStatus();
};

// ── running timer ────────────────────────────────────────────────────

/** One store per tab — every consumer of `useRunningEntry` shares this clock. */
const timerStore = createTimerStore();

let tickers = 0;
let stopTicking: (() => void) | null = null;

const retainTicker = (): (() => void) => {
  tickers += 1;
  if (tickers === 1) stopTicking = startTicking(timerStore);
  return () => {
    tickers -= 1;
    if (tickers === 0) {
      stopTicking?.();
      stopTicking = null;
    }
  };
};

export type RunningEntry = {
  entry: TimeEntry | null;
  elapsedSec: number;
};

const selectTimerState = (): TimerState => timerStore.getState();
const selectInitialTimerState = (): TimerState => timerStore.getInitialState();

/**
 * The running entry plus its live elapsed seconds.
 *
 * Elapsed time is recomputed from `entry.start` against the wall clock on
 * every tick (never accumulated), so it survives sleep and throttled tabs.
 * `useSyncExternalStore` keeps the subscription tear-free under React 19
 * concurrent rendering.
 */
export const useRunningEntry = (): RunningEntry => {
  const query = trpc.entries.current.useQuery(undefined, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const entry = query.data ?? null;

  React.useEffect(() => {
    timerStore.getState().setRunning(entry);
  }, [entry]);

  React.useEffect(() => retainTicker(), []);

  const state = React.useSyncExternalStore(
    timerStore.subscribe,
    selectTimerState,
    selectInitialTimerState
  );

  return { entry: state.running, elapsedSec: state.elapsedSec };
};
