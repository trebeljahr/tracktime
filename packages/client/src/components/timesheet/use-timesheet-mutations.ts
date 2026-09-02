"use client";

import * as React from "react";
import { deviceTimeZone } from "@starter/core";
import {
  timesheetRefusalMessage,
  type DetailedEntry,
  type EntryListInput,
  type TimesheetCellPlan,
} from "@starter/shared";

import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import {
  buildOptimisticEntry,
  decorateEntry,
  type EntryShapeContext,
} from "@/lib/entry-shape";
import {
  cancelQueuedForTemp,
  createTempId,
  enqueueOffline,
  isNetworkError,
  isTempId,
  type OfflineCreateInput,
  type OfflineIdInput,
  type OfflineUpdateInput,
} from "@/lib/offline";
import { trpc } from "@/lib/trpc";

/** What a plan needs to know beyond the numbers: which row it belongs to. */
export type CellEditContext = {
  projectId: string | null;
  taskId: string | null;
  /** Falls back to the project's `billableDefault` when omitted. */
  billable?: boolean;
};

export type TimesheetMutations = {
  /** Execute a plan from `planCellEdit`. Refusals surface as a toast. */
  applyPlan: (plan: TimesheetCellPlan, context: CellEditContext) => void;
  isBusy: boolean;
};

type ListSnapshot = { entries: DetailedEntry[]; nextCursor?: string } | undefined;

/**
 * The writes a timesheet cell performs.
 *
 * Three things this shares with the tracker rather than reinventing:
 *
 *  - the SERVER path. A cell creates entries through `entries.create`, so the
 *    hourly-rate and currency snapshot happens in exactly one place and grid
 *    entries carry the same history-proof rate as timed ones.
 *  - the OFFLINE contract. Failures that never reached the server keep their
 *    optimistic result and park on the same queue the tracker and the browser
 *    extension replay, under the same op names.
 *  - the ECHO guard. Every input carries `originId`, so the sync broadcast this
 *    tab caused is ignored instead of refetching over an update already made.
 *
 * What is local is the cache it patches: the timesheet reads one week of
 * entries under its own query key, so its optimistic writes go there.
 */
export const useTimesheetMutations = (
  listInput: EntryListInput
): TimesheetMutations => {
  const utils = trpc.useUtils();

  const shapeContext = React.useCallback(
    (projectId: string | null): EntryShapeContext => ({
      projects: utils.projects.list.getData({}) ?? [],
      tasks:
        projectId === null
          ? []
          : utils.tasks.list.getData({ projectId }) ?? [],
      settings: utils.settings.get.getData() ?? null,
    }),
    [utils]
  );

  const billableFor = React.useCallback(
    (projectId: string | null, explicit: boolean | undefined): boolean => {
      if (explicit !== undefined) return explicit;
      const project = utils.projects.list
        .getData({})
        ?.find((candidate) => candidate.id === projectId);
      return project?.billableDefault ?? false;
    },
    [utils]
  );

  const patchList = React.useCallback(
    (fn: (entries: DetailedEntry[]) => DetailedEntry[]): void => {
      utils.entries.list.setData(listInput, (data) =>
        data === undefined ? data : { ...data, entries: fn(data.entries) }
      );
    },
    [listInput, utils]
  );

  const snapshot = React.useCallback(async (): Promise<ListSnapshot> => {
    await utils.entries.list.cancel(listInput);
    return utils.entries.list.getData(listInput);
  }, [listInput, utils]);

  const restore = React.useCallback(
    (previous: ListSnapshot): void => {
      utils.entries.list.setData(listInput, previous);
    },
    [listInput, utils]
  );

  const invalidate = React.useCallback((): void => {
    void utils.entries.invalidate();
    void utils.reports.invalidate();
  }, [utils]);

  const [pending, setPending] = React.useState(0);

  /**
   * One write, optimistically applied.
   *
   * `queue` is what makes the edit survive a dead network: it is only reached
   * when the request never got an answer, and it leaves the optimistic cache
   * exactly as it is.
   */
  const run = React.useCallback(
    async (args: {
      optimistic: (entries: DetailedEntry[]) => DetailedEntry[];
      perform: () => Promise<void>;
      queue: () => Promise<void>;
      failure: string;
    }): Promise<void> => {
      const previous = await snapshot();
      patchList(args.optimistic);
      setPending((count) => count + 1);

      try {
        await args.perform();
        invalidate();
      } catch (error) {
        if (isNetworkError(error)) {
          await args.queue();
          return;
        }
        restore(previous);
        toast.error(
          error instanceof Error && error.message !== ""
            ? error.message
            : args.failure
        );
      } finally {
        setPending((count) => Math.max(0, count - 1));
      }
    },
    [invalidate, patchList, restore, snapshot]
  );

  const createEntry = trpc.entries.create.useMutation();
  const updateEntry = trpc.entries.update.useMutation();
  const removeEntry = trpc.entries.remove.useMutation();

  const create = React.useCallback(
    (start: string, end: string, context: CellEditContext): void => {
      const billable = billableFor(context.projectId, context.billable);
      const tempId = createTempId();
      const input: OfflineCreateInput = {
        description: "",
        projectId: context.projectId,
        taskId: context.taskId,
        billable,
        start,
        end,
        source: "web",
        timeZone: deviceTimeZone(),
        originId: ORIGIN_ID,
      };
      const optimistic = buildOptimisticEntry(shapeContext(context.projectId), {
        id: tempId,
        description: "",
        projectId: context.projectId,
        taskId: context.taskId,
        billable,
        start,
        end,
      });

      void run({
        optimistic: (entries) => [optimistic, ...entries],
        perform: async () => {
          const created = await createEntry.mutateAsync(input);
          patchList((entries) =>
            entries.map((entry) =>
              entry.id === tempId
                ? decorateEntry(shapeContext(created.projectId), created)
                : entry
            )
          );
        },
        queue: () => enqueueOffline("entries.create", input, tempId),
        failure: "Could not add the time",
      });
    },
    [billableFor, createEntry, patchList, run, shapeContext]
  );

  const adjust = React.useCallback(
    (id: string, end: string): void => {
      if (isTempId(id)) {
        // The server has never seen this entry; an update would be lost the
        // moment the queued create replays under a real id.
        toast.info("Still syncing — try again in a moment.");
        return;
      }
      const input: OfflineUpdateInput = { id, end, originId: ORIGIN_ID };

      void run({
        optimistic: (entries) =>
          entries.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  end,
                  durationSec: Math.max(
                    0,
                    Math.round((Date.parse(end) - Date.parse(entry.start)) / 1000)
                  ),
                }
              : entry
          ),
        perform: async () => {
          await updateEntry.mutateAsync(input);
        },
        queue: () => enqueueOffline("entries.update", input),
        failure: "Could not save the change",
      });
    },
    [run, updateEntry]
  );

  const remove = React.useCallback(
    (id: string, context: CellEditContext): void => {
      const existing = utils.entries.list
        .getData(listInput)
        ?.entries.find((entry) => entry.id === id);

      if (isTempId(id)) {
        // Never reached the server — drop it locally and cancel its replay,
        // so the create cannot resurrect an entry the user just cleared.
        patchList((entries) => entries.filter((entry) => entry.id !== id));
        void cancelQueuedForTemp(id);
        return;
      }

      const input: OfflineIdInput = { id, originId: ORIGIN_ID };

      void run({
        optimistic: (entries) => entries.filter((entry) => entry.id !== id),
        perform: async () => {
          await removeEntry.mutateAsync(input);
          // Clearing a cell deletes tracked time, so the way back is offered
          // rather than assumed — the grid has no other undo.
          if (existing?.end) {
            toast.message("Entry removed", {
              action: {
                label: "Undo",
                onClick: () =>
                  create(existing.start, existing.end ?? existing.start, context),
              },
            });
          }
        },
        queue: () => enqueueOffline("entries.remove", input),
        failure: "Could not remove the time",
      });
    },
    [create, listInput, patchList, removeEntry, run, utils]
  );

  const applyPlan = React.useCallback(
    (plan: TimesheetCellPlan, context: CellEditContext): void => {
      switch (plan.kind) {
        case "noop":
          return;
        case "refuse":
          toast.error(timesheetRefusalMessage(plan.reason));
          return;
        case "create":
          create(plan.start, plan.end, context);
          return;
        case "adjust":
          adjust(plan.id, plan.end);
          return;
        case "delete":
          remove(plan.id, context);
          return;
      }
    },
    [adjust, create, remove]
  );

  return { applyPlan, isBusy: pending > 0 };
};
