"use client";

import * as React from "react";
import { deviceTimeZone } from "@starter/core";
import {
  entryAmount,
  formatDurationShort,
  resolveHourlyRate,
  type DetailedEntry,
  type TimeEntry,
} from "@starter/shared";

import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";
import {
  cancelQueuedForTemp,
  createTempId,
  enqueueOffline,
  isNetworkError,
  isTempId,
  type OfflineCreateInput,
  type OfflineIdInput,
  type OfflineStartInput,
  type OfflineStopInput,
  type OfflineUpdateInput,
} from "@/lib/offline";

/**
 * The entry list covers all of history and is paged with the server cursor, so
 * the window is a constant. A constant keeps the react-query key stable, which
 * is what lets every mutation write into exactly one cache.
 */
export const TRACKER_LIST_INPUT: {
  from: string;
  to: string;
  limit: number;
} = { from: "2000-01-01", to: "2999-12-31", limit: 50 };

type Utils = ReturnType<typeof trpc.useUtils>;
type ListSnapshot = ReturnType<Utils["entries"]["list"]["getInfiniteData"]>;

type MutationContext = {
  previousCurrent?: TimeEntry | null;
  previousList?: ListSnapshot;
  /** Set when this mutation invented an entry the server has not seen yet. */
  tempId?: string;
  /** Flipped in `onError` when the mutation was parked in the offline queue. */
  queued?: boolean;
};

const byStartDesc = (a: DetailedEntry, b: DetailedEntry): number => {
  const delta = Date.parse(b.start) - Date.parse(a.start);
  return delta !== 0 ? delta : b.id.localeCompare(a.id);
};

const durationBetween = (start: string, end: string): number =>
  Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));

const nowIso = (): string => new Date().toISOString();

/**
 * Below this, a stopped entry is probably a misfire — a stray click on Start,
 * or continuing the wrong row — rather than real tracked time.
 *
 * It is never discarded automatically: silently deleting time someone tracked
 * is far worse than leaving a short row in the list. The offer is made once, in
 * the toast, and ignoring it keeps the entry.
 */
const SHORT_ENTRY_SEC = 60;

export type StartTimerArgs = {
  description: string;
  projectId: string | null;
  taskId?: string | null;
  billable: boolean;
};

export type ManualEntryArgs = StartTimerArgs & {
  start: string;
  end: string;
};

export type UpdateEntryArgs = {
  id: string;
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  start?: string;
  end?: string | null;
};

export type EntryMutations = {
  startTimer: (args: StartTimerArgs) => void;
  stopTimer: () => void;
  continueEntry: (entry: DetailedEntry) => void;
  createManualEntry: (args: ManualEntryArgs) => void;
  updateEntry: (args: UpdateEntryArgs) => void;
  duplicateEntry: (entry: DetailedEntry) => void;
  removeEntry: (entry: DetailedEntry) => void;
  isBusy: boolean;
};

/**
 * Every write the tracker performs, wrapped in the same three guarantees:
 *
 *  1. optimistic — cancel, snapshot, `setData`, roll back on a server error;
 *  2. offline-tolerant — a mutation that never reached the server keeps its
 *     optimistic result and is queued for replay instead of rolling back;
 *  3. echo-safe — every input carries `originId` so this tab ignores the sync
 *     broadcast its own mutation caused.
 */
export const useEntryMutations = (): EntryMutations => {
  const utils = trpc.useUtils();

  // `removeEntry` is declared below the mutations that need to call it, so the
  // toast action reaches it through a ref rather than reordering the file.
  const removeEntryRef = React.useRef<((entry: DetailedEntry) => void) | null>(
    null
  );

  // ── cache helpers ──────────────────────────────────────────────────

  const patchList = React.useCallback(
    (fn: (entries: DetailedEntry[]) => DetailedEntry[]): void => {
      utils.entries.list.setInfiniteData(TRACKER_LIST_INPUT, (data) =>
        data === undefined
          ? data
          : {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                entries: fn(page.entries),
              })),
            }
      );
    },
    [utils]
  );

  const insertEntry = React.useCallback(
    (entry: DetailedEntry): void => {
      utils.entries.list.setInfiniteData(TRACKER_LIST_INPUT, (data) => {
        if (data === undefined) return data;
        const [first, ...rest] = data.pages;
        if (first === undefined) return data;
        return {
          ...data,
          pages: [
            { ...first, entries: [entry, ...first.entries].sort(byStartDesc) },
            ...rest,
          ],
        };
      });
    },
    [utils]
  );

  const replaceEntry = React.useCallback(
    (id: string, next: DetailedEntry): void => {
      patchList((entries) =>
        entries.map((entry) => (entry.id === id ? next : entry))
      );
    },
    [patchList]
  );

  const dropEntry = React.useCallback(
    (id: string): void => {
      patchList((entries) => entries.filter((entry) => entry.id !== id));
    },
    [patchList]
  );

  const snapshot = React.useCallback(async (): Promise<MutationContext> => {
    await utils.entries.current.cancel();
    await utils.entries.list.cancel();
    return {
      previousCurrent: utils.entries.current.getData(),
      previousList: utils.entries.list.getInfiniteData(TRACKER_LIST_INPUT),
    };
  }, [utils]);

  const rollback = React.useCallback(
    (context: MutationContext | undefined): void => {
      if (context === undefined) return;
      if (context.previousCurrent !== undefined) {
        utils.entries.current.setData(undefined, context.previousCurrent);
      }
      if (context.previousList !== undefined) {
        utils.entries.list.setInfiniteData(
          TRACKER_LIST_INPUT,
          context.previousList
        );
      }
    },
    [utils]
  );

  const invalidate = React.useCallback(async (): Promise<void> => {
    await utils.entries.invalidate();
    await utils.reports.invalidate();
  }, [utils]);

  // ── optimistic entry construction ──────────────────────────────────

  type ProjectFacts = {
    projectName: string | null;
    projectColor: string | null;
    clientName: string | null;
    /** The project's configured rate — an input to the snapshot, not a value. */
    projectRate: number | null;
  };

  const describeProject = React.useCallback(
    (projectId: string | null): ProjectFacts => {
      if (projectId === null) {
        return {
          projectName: null,
          projectColor: null,
          clientName: null,
          projectRate: null,
        };
      }
      const project = utils.projects.list
        .getData({})
        ?.find((candidate) => candidate.id === projectId);
      return {
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        clientName: project?.clientName ?? null,
        projectRate: project?.hourlyRate ?? null,
      };
    },
    [utils]
  );

  /** Decorate a server entry with the catalog labels the list renders. */
  const toDetailed = React.useCallback(
    (entry: TimeEntry): DetailedEntry => {
      const project = describeProject(entry.projectId);
      return {
        ...entry,
        projectName: project.projectName,
        projectColor: project.projectColor,
        clientName: project.clientName,
        taskName: null,
        amount: entryAmount(entry.durationSec, entry.hourlyRate),
      };
    },
    [describeProject]
  );

  const buildEntry = React.useCallback(
    (args: {
      id: string;
      description: string;
      projectId: string | null;
      taskId: string | null;
      billable: boolean;
      start: string;
      end: string | null;
    }): DetailedEntry => {
      const settings = utils.settings.get.getData();
      const project = describeProject(args.projectId);
      const hourlyRate = resolveHourlyRate({
        billable: args.billable,
        projectRate: project.projectRate,
        defaultRate: settings?.defaultHourlyRate ?? null,
      });
      const durationSec =
        args.end === null ? 0 : durationBetween(args.start, args.end);
      const stamp = nowIso();

      return {
        id: args.id,
        ownerId: settings?.userId ?? "",
        description: args.description,
        projectId: args.projectId,
        taskId: args.taskId,
        billable: args.billable,
        start: args.start,
        end: args.end,
        durationSec,
        hourlyRate,
        currency: settings?.currency ?? "EUR",
        source: "web",
        timeZone: deviceTimeZone(),
        createdAt: stamp,
        updatedAt: stamp,
        projectName: project.projectName,
        projectColor: project.projectColor,
        clientName: project.clientName,
        taskName: null,
        amount: entryAmount(durationSec, hourlyRate),
      };
    },
    [describeProject, utils]
  );

  /** The stopped shape the server would write for a running entry. */
  const stopShape = React.useCallback(
    (running: TimeEntry, end: string): DetailedEntry => {
      const settings = utils.settings.get.getData();
      const project = describeProject(running.projectId);
      const safeEnd =
        Date.parse(end) > Date.parse(running.start) ? end : running.start;
      const hourlyRate = resolveHourlyRate({
        billable: running.billable,
        projectRate: project.projectRate,
        defaultRate: settings?.defaultHourlyRate ?? null,
      });
      const durationSec = durationBetween(running.start, safeEnd);

      return {
        ...running,
        end: safeEnd,
        durationSec,
        hourlyRate,
        currency: settings?.currency ?? running.currency,
        updatedAt: safeEnd,
        projectName: project.projectName,
        projectColor: project.projectColor,
        clientName: project.clientName,
        taskName: null,
        amount: entryAmount(durationSec, hourlyRate),
      };
    },
    [describeProject, utils]
  );

  /**
   * Shared error path. A transport failure keeps the optimistic result and
   * parks the mutation for replay; anything the server actually answered
   * rolls the cache back and surfaces the message.
   */
  const handleError = React.useCallback(
    async (
      error: unknown,
      context: MutationContext | undefined,
      enqueue: (tempId?: string) => Promise<void>,
      fallbackMessage: string
    ): Promise<void> => {
      if (isNetworkError(error)) {
        if (context) context.queued = true;
        await enqueue(context?.tempId);
        return;
      }
      rollback(context);
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : fallbackMessage;
      toast.error(message);
    },
    [rollback]
  );

  // ── mutations ──────────────────────────────────────────────────────

  const startMutation = trpc.entries.start.useMutation({
    onMutate: async (raw): Promise<MutationContext> => {
      const input = raw as OfflineStartInput;
      const context = await snapshot();
      context.tempId = createTempId();

      const running = context.previousCurrent ?? null;
      if (running) replaceEntry(running.id, stopShape(running, input.start));

      const optimistic = buildEntry({
        id: context.tempId,
        description: input.description,
        projectId: input.projectId,
        taskId: input.taskId,
        billable: input.billable,
        start: input.start,
        end: null,
      });
      utils.entries.current.setData(undefined, optimistic);
      insertEntry(optimistic);
      return context;
    },
    onSuccess: (entry, _raw, context) => {
      if (context?.tempId) replaceEntry(context.tempId, toDetailed(entry));
      utils.entries.current.setData(undefined, entry);
    },
    onError: (error, raw, context) =>
      handleError(
        error,
        context,
        (tempId) =>
          enqueueOffline("entries.start", raw as OfflineStartInput, tempId),
        "Could not start the timer"
      ),
    onSettled: async (_data, _error, _raw, context) => {
      if (context?.queued) return;
      await invalidate();
    },
  });

  const stopMutation = trpc.entries.stop.useMutation({
    onMutate: async (raw): Promise<MutationContext> => {
      const input = raw as OfflineStopInput;
      const context = await snapshot();
      const running = context.previousCurrent ?? null;
      if (running) {
        replaceEntry(running.id, stopShape(running, input.end));
        // A timer started offline still carries its temp id; keep the link so
        // a later delete can cancel the whole queued pair.
        if (isTempId(running.id)) context.tempId = running.id;
      }
      utils.entries.current.setData(undefined, null);
      return context;
    },
    onSuccess: (entry, _raw, context) => {
      if (context?.tempId) dropEntry(context.tempId);
      const detailed = toDetailed(entry);
      replaceEntry(entry.id, detailed);
      utils.entries.current.setData(undefined, null);

      // Includes a zero-second entry: an immediate start-then-stop is the
      // most obvious misfire there is, and used to get no offer at all.
      if (entry.durationSec < SHORT_ENTRY_SEC) {
        toast.message(
          `Stopped after ${formatDurationShort(entry.durationSec)}`,
          {
            description: "Short entries are kept unless you discard them.",
            action: {
              label: "Discard",
              onClick: () => removeEntryRef.current?.(detailed),
            },
          }
        );
      }
    },
    onError: (error, raw, context) =>
      handleError(
        error,
        context,
        () =>
          // No `id` on purpose: on replay the server stops whatever the
          // already-replayed start opened.
          enqueueOffline("entries.stop", {
            end: (raw as OfflineStopInput).end,
            originId: ORIGIN_ID,
          }),
        "Could not stop the timer"
      ),
    onSettled: async (_data, _error, _raw, context) => {
      if (context?.queued) return;
      await invalidate();
    },
  });

  const createMutation = trpc.entries.create.useMutation({
    onMutate: async (raw): Promise<MutationContext> => {
      const input = raw as OfflineCreateInput;
      const context = await snapshot();
      context.tempId = createTempId();
      insertEntry(
        buildEntry({
          id: context.tempId,
          description: input.description,
          projectId: input.projectId,
          taskId: input.taskId,
          billable: input.billable,
          start: input.start,
          end: input.end,
        })
      );
      return context;
    },
    onSuccess: (entry, _raw, context) => {
      if (context?.tempId) replaceEntry(context.tempId, toDetailed(entry));
    },
    onError: (error, raw, context) =>
      handleError(
        error,
        context,
        (tempId) =>
          enqueueOffline("entries.create", raw as OfflineCreateInput, tempId),
        "Could not add the entry"
      ),
    onSettled: async (_data, _error, _raw, context) => {
      if (context?.queued) return;
      await invalidate();
    },
  });

  const updateMutation = trpc.entries.update.useMutation({
    onMutate: async (raw): Promise<MutationContext> => {
      const input = raw as OfflineUpdateInput;
      const context = await snapshot();
      const settings = utils.settings.get.getData();

      patchList((entries) =>
        entries.map((entry) => {
          if (entry.id !== input.id) return entry;

          const projectId =
            input.projectId === undefined
              ? entry.projectId
              : input.projectId ?? null;
          const billable = input.billable ?? entry.billable;
          const start = input.start ?? entry.start;
          const end = input.end === undefined ? entry.end : input.end;
          const project = describeProject(projectId);
          const hourlyRate = resolveHourlyRate({
            billable,
            projectRate: project.projectRate,
            defaultRate: settings?.defaultHourlyRate ?? null,
          });
          const durationSec = end === null ? 0 : durationBetween(start, end);

          return {
            ...entry,
            description: input.description ?? entry.description,
            projectId,
            taskId:
              input.taskId === undefined ? entry.taskId : input.taskId ?? null,
            billable,
            start,
            end,
            durationSec,
            hourlyRate,
            updatedAt: nowIso(),
            projectName: project.projectName,
            projectColor: project.projectColor,
            clientName: project.clientName,
            amount: entryAmount(durationSec, hourlyRate),
          };
        })
      );

      const running = context.previousCurrent ?? null;
      if (running && running.id === input.id) {
        if (input.end !== undefined && input.end !== null) {
          utils.entries.current.setData(undefined, null);
        } else {
          utils.entries.current.setData(undefined, {
            ...running,
            description: input.description ?? running.description,
            projectId:
              input.projectId === undefined
                ? running.projectId
                : input.projectId ?? null,
            taskId:
              input.taskId === undefined
                ? running.taskId
                : input.taskId ?? null,
            billable: input.billable ?? running.billable,
            start: input.start ?? running.start,
          });
        }
      }

      return context;
    },
    onSuccess: (entry) => {
      replaceEntry(entry.id, toDetailed(entry));
      if (entry.end === null) utils.entries.current.setData(undefined, entry);
    },
    onError: (error, raw, context) =>
      handleError(
        error,
        context,
        () => enqueueOffline("entries.update", raw as OfflineUpdateInput),
        "Could not save the entry"
      ),
    onSettled: async (_data, _error, _raw, context) => {
      if (context?.queued) return;
      await invalidate();
    },
  });

  const removeMutation = trpc.entries.remove.useMutation({
    onMutate: async (raw): Promise<MutationContext> => {
      const input = raw as OfflineIdInput;
      const context = await snapshot();
      dropEntry(input.id);
      if (context.previousCurrent?.id === input.id) {
        utils.entries.current.setData(undefined, null);
      }
      return context;
    },
    onError: (error, raw, context) =>
      handleError(
        error,
        context,
        () => enqueueOffline("entries.remove", raw as OfflineIdInput),
        "Could not delete the entry"
      ),
    onSettled: async (_data, _error, _raw, context) => {
      if (context?.queued) return;
      await invalidate();
    },
  });

  // ── public API ─────────────────────────────────────────────────────

  const startTimer = React.useCallback(
    (args: StartTimerArgs): void => {
      const input: OfflineStartInput = {
        description: args.description,
        projectId: args.projectId,
        taskId: args.taskId ?? null,
        billable: args.billable,
        start: nowIso(),
        source: "web",
        timeZone: deviceTimeZone(),
        originId: ORIGIN_ID,
      };
      startMutation.mutate(input);
    },
    [startMutation]
  );

  const stopTimer = React.useCallback((): void => {
    const input: OfflineStopInput = { end: nowIso(), originId: ORIGIN_ID };
    stopMutation.mutate(input);
  }, [stopMutation]);

  const continueEntry = React.useCallback(
    (entry: DetailedEntry): void => {
      // Continuing the entry that is already running would stop it and start an
      // identical copy, shredding one stretch of work into fragments. The row
      // renders Stop instead of Continue for exactly this reason; this guard
      // covers every other caller.
      if (entry.end === null) return;

      // Deliberately `start`, not `continue`: every field is already in hand,
      // so this works offline where a server-side copy could not.
      startTimer({
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        billable: entry.billable,
      });
    },
    [startTimer]
  );

  const createManualEntry = React.useCallback(
    (args: ManualEntryArgs): void => {
      const input: OfflineCreateInput = {
        description: args.description,
        projectId: args.projectId,
        taskId: args.taskId ?? null,
        billable: args.billable,
        start: args.start,
        end: args.end,
        source: "web",
        timeZone: deviceTimeZone(),
        originId: ORIGIN_ID,
      };
      createMutation.mutate(input);
    },
    [createMutation]
  );

  const updateEntry = React.useCallback(
    (args: UpdateEntryArgs): void => {
      if (isTempId(args.id)) {
        // The server has never seen this entry, so an edit would be lost the
        // moment the queued create replays. Rows disable their editors while
        // this is true; this guard is the backstop.
        toast.info("Still syncing — try again in a moment.");
        return;
      }
      const input: OfflineUpdateInput = { ...args, originId: ORIGIN_ID };
      updateMutation.mutate(input);
    },
    [updateMutation]
  );

  const duplicateEntry = React.useCallback(
    (entry: DetailedEntry): void => {
      createManualEntry({
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        billable: entry.billable,
        start: entry.start,
        end: entry.end ?? nowIso(),
      });
    },
    [createManualEntry]
  );

  const removeEntry = React.useCallback(
    (entry: DetailedEntry): void => {
      if (isTempId(entry.id)) {
        // Never reached the server — drop it locally and cancel its replay.
        dropEntry(entry.id);
        if (utils.entries.current.getData()?.id === entry.id) {
          utils.entries.current.setData(undefined, null);
        }
        void cancelQueuedForTemp(entry.id);
        return;
      }
      removeMutation.mutate({ id: entry.id, originId: ORIGIN_ID });
    },
    [dropEntry, removeMutation, utils]
  );

  removeEntryRef.current = removeEntry;

  return {
    startTimer,
    stopTimer,
    continueEntry,
    createManualEntry,
    updateEntry,
    duplicateEntry,
    removeEntry,
    isBusy:
      startMutation.isPending ||
      stopMutation.isPending ||
      createMutation.isPending ||
      updateMutation.isPending ||
      removeMutation.isPending,
  };
};
