"use client";

import * as React from "react";
import type { DetailedEntry } from "@starter/shared";

import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** The exact `entries.list` input the calendar screen is showing. */
export type CalendarQueryInput = {
  from: string;
  to: string;
  limit: number;
};

type ListData = { entries: DetailedEntry[]; nextCursor?: string };

/** Fields a calendar interaction can change on an existing entry. */
export type EntryPatch = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  start?: string;
  end?: string | null;
};

/** Everything needed to create an entry from a drag or the create dialog. */
export type EntryDraft = {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable?: boolean;
  start: string;
  end: string;
};

const durationOf = (start: string, end: string | null): number => {
  if (end === null) return 0;
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
};

const amountOf = (durationSec: number, hourlyRate: number | null): number =>
  hourlyRate === null ? 0 : (durationSec / 3600) * hourlyRate;

/** Newest first, matching the server's `start desc` ordering. */
const sortEntries = (entries: DetailedEntry[]): DetailedEntry[] =>
  [...entries].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

export type CalendarEntries = {
  entries: DetailedEntry[];
  isLoading: boolean;
};

/** Every entry overlapping the visible window, running entries included. */
export const useCalendarEntries = (
  input: CalendarQueryInput
): CalendarEntries => {
  const query = trpc.entries.list.useQuery(input, { staleTime: 10_000 });
  return {
    entries: query.data?.entries ?? [],
    isLoading: query.isPending,
  };
};

export type CalendarActions = {
  update: (id: string, patch: EntryPatch) => void;
  create: (draft: EntryDraft) => void;
  remove: (id: string) => void;
  isMutating: boolean;
};

/**
 * Optimistic create/update/delete against the calendar's `entries.list`
 * cache. Every mutation carries `originId` so the socket echo of our own
 * write is ignored instead of re-fetching what we already painted.
 */
export const useCalendarActions = (
  input: CalendarQueryInput
): CalendarActions => {
  const utils = trpc.useUtils();
  const { currency } = useFormatSettings();
  const projects = trpc.projects.list.useQuery({});
  const projectsData = projects.data;

  const projectMeta = React.useCallback(
    (
      projectId: string | null
    ): {
      projectName: string | null;
      projectColor: string | null;
      clientName: string | null;
    } => {
      const project = projectId
        ? projectsData?.find((candidate) => candidate.id === projectId)
        : undefined;
      return {
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        clientName: project?.clientName ?? null,
      };
    },
    [projectsData]
  );

  const snapshot = React.useCallback(async (): Promise<ListData | undefined> => {
    await utils.entries.list.cancel(input);
    return utils.entries.list.getData(input);
  }, [input, utils]);

  const rollback = React.useCallback(
    (previous: ListData | undefined): void => {
      if (previous) utils.entries.list.setData(input, previous);
    },
    [input, utils]
  );

  const settle = React.useCallback((): void => {
    void utils.entries.invalidate();
    void utils.reports.invalidate();
  }, [utils]);

  const updateMutation = trpc.entries.update.useMutation({
    onMutate: async (variables) => {
      const previous = await snapshot();
      utils.entries.list.setData(input, (current) => {
        if (!current) return current;
        return {
          ...current,
          entries: sortEntries(
            current.entries.map((entry) => {
              if (entry.id !== variables.id) return entry;
              const start = variables.start ?? entry.start;
              const end =
                variables.end === undefined ? entry.end : variables.end;
              const durationSec = durationOf(start, end);
              const projectId =
                variables.projectId === undefined
                  ? entry.projectId
                  : variables.projectId ?? null;
              const meta =
                variables.projectId === undefined
                  ? {
                      projectName: entry.projectName,
                      projectColor: entry.projectColor,
                      clientName: entry.clientName,
                    }
                  : projectMeta(projectId);
              return {
                ...entry,
                ...meta,
                description: variables.description ?? entry.description,
                projectId,
                taskId:
                  variables.taskId === undefined
                    ? entry.taskId
                    : variables.taskId ?? null,
                billable: variables.billable ?? entry.billable,
                start,
                end,
                durationSec,
                // timeZone is deliberately absent: an edit must not restamp the
                // zone the entry was recorded in. The spread above preserves it.
                amount: amountOf(durationSec, entry.hourlyRate),
                updatedAt: new Date().toISOString(),
              };
            })
          ),
        };
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      rollback(context?.previous);
      toast.error(error.message);
    },
    onSettled: settle,
  });

  const createMutation = trpc.entries.create.useMutation({
    onMutate: async (variables) => {
      const previous = await snapshot();
      const now = new Date().toISOString();
      const projectId = variables.projectId ?? null;
      const durationSec = durationOf(variables.start, variables.end);
      const optimistic: DetailedEntry = {
        id: `optimistic-${now}`,
        ownerId: "",
        description: variables.description ?? "",
        projectId,
        taskId: variables.taskId ?? null,
        billable: variables.billable ?? false,
        start: variables.start,
        end: variables.end,
        durationSec,
        hourlyRate: null,
        currency,
        source: "web",
        timeZone: variables.timeZone ?? null,
        createdAt: now,
        updatedAt: now,
        ...projectMeta(projectId),
        taskName: null,
        amount: 0,
      };
      utils.entries.list.setData(input, (current) =>
        current
          ? { ...current, entries: sortEntries([optimistic, ...current.entries]) }
          : current
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      rollback(context?.previous);
      toast.error(error.message);
    },
    onSettled: settle,
  });

  const removeMutation = trpc.entries.remove.useMutation({
    onMutate: async (variables) => {
      const previous = await snapshot();
      utils.entries.list.setData(input, (current) =>
        current
          ? {
              ...current,
              entries: current.entries.filter(
                (entry) => entry.id !== variables.id
              ),
            }
          : current
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      rollback(context?.previous);
      toast.error(error.message);
    },
    onSettled: settle,
  });

  const update = React.useCallback(
    (id: string, patch: EntryPatch): void => {
      updateMutation.mutate({ id, ...patch, originId: ORIGIN_ID });
    },
    [updateMutation]
  );

  const create = React.useCallback(
    (draft: EntryDraft): void => {
      createMutation.mutate({ ...draft, originId: ORIGIN_ID });
    },
    [createMutation]
  );

  const remove = React.useCallback(
    (id: string): void => {
      removeMutation.mutate({ id, originId: ORIGIN_ID });
    },
    [removeMutation]
  );

  return {
    update,
    create,
    remove,
    isMutating:
      updateMutation.isPending ||
      createMutation.isPending ||
      removeMutation.isPending,
  };
};
