"use client";

import { createId } from "@starter/core";

import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";
import {
  CLIENT_LIST_INPUT,
  PROJECT_LIST_INPUT,
  errorMessage,
  isConflict,
  sortByName,
  taskListInput,
  type ClientRow,
  type CreatedClient,
  type CreatedProject,
  type CreatedTask,
  type CreateClientVars,
  type CreateProjectVars,
  type CreateTaskVars,
  type ProjectRow,
  type RemoveResult,
  type TaskRow,
  type UpdateClientVars,
  type UpdateProjectVars,
  type UpdateTaskVars,
} from "./types";

/**
 * Forms pass `onConflict` so a duplicate name lands inline on the field
 * instead of in a toast. Everything else is surfaced as a toast.
 */
export type CatalogErrorHandlers = {
  onConflict?: (message: string) => void;
};

const DEFAULT_COLOR = "#4f46e5";

function reportError(
  error: unknown,
  fallback: string,
  handlers: CatalogErrorHandlers,
): void {
  const message = errorMessage(error, fallback);
  if (isConflict(error) && handlers.onConflict) {
    handlers.onConflict(message);
    return;
  }
  toast.error(message);
}

/** "42 time entries reference this project" — honest, never "deleted". */
function archivedInsteadMessage(
  noun: string,
  entryCount: number,
  serverMessage: string | null,
): string {
  if (entryCount > 0) {
    const plural = entryCount === 1 ? "entry" : "entries";
    return `Archived instead — ${entryCount} time ${plural} reference this ${noun}.`;
  }
  return (
    serverMessage ??
    `Archived instead — tracked time still references this ${noun}.`
  );
}

function announceRemoval(
  result: RemoveResult,
  noun: string,
  entryCount: number,
): void {
  if (result.deleted) {
    toast.success(
      `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted.`,
    );
    return;
  }
  toast.warning(archivedInsteadMessage(noun, entryCount, result.message));
}

// ── projects ─────────────────────────────────────────────────────────

export type ProjectMutations = {
  /** Resolves to the created project, or null when the server refused. */
  createProject: (vars: CreateProjectVars) => Promise<CreatedProject | null>;
  updateProject: (vars: UpdateProjectVars) => Promise<CreatedProject | null>;
  setProjectArchived: (id: string, archived: boolean) => void;
  removeProject: (id: string) => void;
  isSaving: boolean;
};

export function useProjectMutations(
  handlers: CatalogErrorHandlers = {},
): ProjectMutations {
  const utils = trpc.useUtils();

  const readProjects = (): ProjectRow[] =>
    utils.projects.list.getData(PROJECT_LIST_INPUT) ?? [];

  const findClient = (id: string | null | undefined): ClientRow | null => {
    if (!id) return null;
    const clients = utils.clients.list.getData(CLIENT_LIST_INPUT) ?? [];
    return clients.find((client) => client.id === id) ?? null;
  };

  const writeProjects = (
    update: (rows: ProjectRow[]) => ProjectRow[],
  ): void => {
    utils.projects.list.setData(PROJECT_LIST_INPUT, (old) =>
      old === undefined ? old : update(old),
    );
  };

  const beginProjectWrite = async (): Promise<{
    previous: ProjectRow[] | undefined;
  }> => {
    await utils.projects.list.cancel(PROJECT_LIST_INPUT);
    return { previous: utils.projects.list.getData(PROJECT_LIST_INPUT) };
  };

  const rollbackProjects = (previous: ProjectRow[] | undefined): void => {
    if (previous !== undefined) {
      utils.projects.list.setData(PROJECT_LIST_INPUT, previous);
    }
  };

  const settleProjects = (): void => {
    void utils.projects.list.invalidate();
  };

  const create = trpc.projects.create.useMutation({
    onMutate: async (vars) => {
      const context = await beginProjectWrite();
      const now = new Date().toISOString();
      const client = findClient(vars.clientId);
      const optimistic: ProjectRow = {
        id: `optimistic-${createId()}`,
        ownerId: "",
        name: vars.name.trim(),
        color: vars.color ?? DEFAULT_COLOR,
        clientId: vars.clientId ?? null,
        billableDefault: vars.billableDefault ?? true,
        hourlyRate: vars.hourlyRate ?? null,
        archived: false,
        createdAt: now,
        updatedAt: now,
        clientName: client?.name ?? null,
        clientColor: client?.color ?? null,
        entryCount: 0,
        totalSec: 0,
      };
      writeProjects((rows) => sortByName([...rows, optimistic]));
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackProjects(context?.previous);
      reportError(error, "Could not create the project.", handlers);
    },
    onSettled: settleProjects,
  });

  const update = trpc.projects.update.useMutation({
    onMutate: async (vars) => {
      const context = await beginProjectWrite();
      const client =
        vars.clientId === undefined ? undefined : findClient(vars.clientId);
      writeProjects((rows) =>
        sortByName(
          rows.map((row) => {
            if (row.id !== vars.id) return row;
            return {
              ...row,
              ...(vars.name !== undefined ? { name: vars.name.trim() } : {}),
              ...(vars.color !== undefined ? { color: vars.color } : {}),
              ...(vars.clientId !== undefined
                ? {
                    clientId: vars.clientId ?? null,
                    clientName: client?.name ?? null,
                    clientColor: client?.color ?? null,
                  }
                : {}),
              ...(vars.billableDefault !== undefined
                ? { billableDefault: vars.billableDefault }
                : {}),
              ...(vars.hourlyRate !== undefined
                ? { hourlyRate: vars.hourlyRate ?? null }
                : {}),
              ...(vars.archived !== undefined
                ? { archived: vars.archived }
                : {}),
            };
          }),
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackProjects(context?.previous);
      reportError(error, "Could not save the project.", handlers);
    },
    onSettled: settleProjects,
  });

  const archive = trpc.projects.archive.useMutation({
    onMutate: async (vars) => {
      const context = await beginProjectWrite();
      writeProjects((rows) =>
        rows.map((row) =>
          row.id === vars.id
            ? { ...row, archived: vars.archived ?? true }
            : row,
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackProjects(context?.previous);
      reportError(error, "Could not archive the project.", handlers);
    },
    onSettled: settleProjects,
  });

  const remove = trpc.projects.remove.useMutation({
    onMutate: async (vars) => {
      const context = await beginProjectWrite();
      const entryCount =
        context.previous?.find((row) => row.id === vars.id)?.entryCount ?? 0;
      writeProjects((rows) => rows.filter((row) => row.id !== vars.id));
      return { ...context, entryCount };
    },
    onSuccess: (result, _vars, context) => {
      announceRemoval(result, "project", context?.entryCount ?? 0);
    },
    onError: (error, _vars, context) => {
      rollbackProjects(context?.previous);
      reportError(error, "Could not delete the project.", handlers);
    },
    onSettled: () => {
      settleProjects();
      void utils.tasks.list.invalidate();
    },
  });

  return {
    createProject: (vars) =>
      create.mutateAsync({ ...vars, originId: ORIGIN_ID }).catch(() => null),
    updateProject: (vars) =>
      update.mutateAsync({ ...vars, originId: ORIGIN_ID }).catch(() => null),
    setProjectArchived: (id, archived) => {
      archive.mutate({ id, archived, originId: ORIGIN_ID });
    },
    removeProject: (id) => {
      remove.mutate({ id, originId: ORIGIN_ID });
    },
    isSaving: create.isPending || update.isPending,
  };
}

// ── clients ──────────────────────────────────────────────────────────

export type ClientMutations = {
  createClient: (vars: CreateClientVars) => Promise<CreatedClient | null>;
  updateClient: (vars: UpdateClientVars) => Promise<CreatedClient | null>;
  setClientArchived: (id: string, archived: boolean) => void;
  /** `entryCount` only feeds the "archived instead" toast copy. */
  removeClient: (id: string, entryCount: number) => void;
  isSaving: boolean;
};

export function useClientMutations(
  handlers: CatalogErrorHandlers = {},
): ClientMutations {
  const utils = trpc.useUtils();

  const writeClients = (update: (rows: ClientRow[]) => ClientRow[]): void => {
    utils.clients.list.setData(CLIENT_LIST_INPUT, (old) =>
      old === undefined ? old : update(old),
    );
  };

  const beginClientWrite = async (): Promise<{
    previous: ClientRow[] | undefined;
  }> => {
    await utils.clients.list.cancel(CLIENT_LIST_INPUT);
    return { previous: utils.clients.list.getData(CLIENT_LIST_INPUT) };
  };

  const rollbackClients = (previous: ClientRow[] | undefined): void => {
    if (previous !== undefined) {
      utils.clients.list.setData(CLIENT_LIST_INPUT, previous);
    }
  };

  // Projects denormalize the client name/colour, so they refresh too.
  const settleClients = (): void => {
    void utils.clients.list.invalidate();
    void utils.projects.list.invalidate();
  };

  const create = trpc.clients.create.useMutation({
    onMutate: async (vars) => {
      const context = await beginClientWrite();
      const now = new Date().toISOString();
      const optimistic: ClientRow = {
        id: `optimistic-${createId()}`,
        ownerId: "",
        name: vars.name.trim(),
        color: vars.color ?? DEFAULT_COLOR,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      writeClients((rows) => sortByName([...rows, optimistic]));
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackClients(context?.previous);
      reportError(error, "Could not create the client.", handlers);
    },
    onSettled: settleClients,
  });

  const update = trpc.clients.update.useMutation({
    onMutate: async (vars) => {
      const context = await beginClientWrite();
      writeClients((rows) =>
        sortByName(
          rows.map((row) =>
            row.id === vars.id
              ? {
                  ...row,
                  ...(vars.name !== undefined
                    ? { name: vars.name.trim() }
                    : {}),
                  ...(vars.color !== undefined ? { color: vars.color } : {}),
                  ...(vars.archived !== undefined
                    ? { archived: vars.archived }
                    : {}),
                }
              : row,
          ),
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackClients(context?.previous);
      reportError(error, "Could not save the client.", handlers);
    },
    onSettled: settleClients,
  });

  const archive = trpc.clients.archive.useMutation({
    onMutate: async (vars) => {
      const context = await beginClientWrite();
      writeClients((rows) =>
        rows.map((row) =>
          row.id === vars.id ? { ...row, archived: vars.archived ?? true } : row,
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackClients(context?.previous);
      reportError(error, "Could not archive the client.", handlers);
    },
    onSettled: settleClients,
  });

  const remove = trpc.clients.remove.useMutation({
    onMutate: async (vars) => {
      const context = await beginClientWrite();
      writeClients((rows) => rows.filter((row) => row.id !== vars.id));
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackClients(context?.previous);
      reportError(error, "Could not delete the client.", handlers);
    },
    onSettled: settleClients,
  });

  return {
    createClient: (vars) =>
      create.mutateAsync({ ...vars, originId: ORIGIN_ID }).catch(() => null),
    updateClient: (vars) =>
      update.mutateAsync({ ...vars, originId: ORIGIN_ID }).catch(() => null),
    setClientArchived: (id, archived) => {
      archive.mutate({ id, archived, originId: ORIGIN_ID });
    },
    removeClient: (id, entryCount) => {
      remove.mutate(
        { id, originId: ORIGIN_ID },
        {
          onSuccess: (result) => {
            announceRemoval(result, "client", entryCount);
          },
        },
      );
    },
    isSaving: create.isPending || update.isPending,
  };
}

// ── tasks ────────────────────────────────────────────────────────────

export type TaskMutations = {
  createTask: (vars: CreateTaskVars) => Promise<CreatedTask | null>;
  updateTask: (vars: UpdateTaskVars) => Promise<CreatedTask | null>;
  setTaskArchived: (id: string, archived: boolean) => void;
  removeTask: (id: string) => void;
  isSaving: boolean;
};

export function useTaskMutations(
  projectId: string,
  handlers: CatalogErrorHandlers = {},
): TaskMutations {
  const utils = trpc.useUtils();
  const input = taskListInput(projectId);

  const writeTasks = (update: (rows: TaskRow[]) => TaskRow[]): void => {
    utils.tasks.list.setData(input, (old) =>
      old === undefined ? old : update(old),
    );
  };

  const beginTaskWrite = async (): Promise<{
    previous: TaskRow[] | undefined;
  }> => {
    await utils.tasks.list.cancel(input);
    return { previous: utils.tasks.list.getData(input) };
  };

  const rollbackTasks = (previous: TaskRow[] | undefined): void => {
    if (previous !== undefined) utils.tasks.list.setData(input, previous);
  };

  const settleTasks = (): void => {
    void utils.tasks.list.invalidate(input);
  };

  const create = trpc.tasks.create.useMutation({
    onMutate: async (vars) => {
      const context = await beginTaskWrite();
      const now = new Date().toISOString();
      const optimistic: TaskRow = {
        id: `optimistic-${createId()}`,
        ownerId: "",
        projectId: vars.projectId,
        name: vars.name.trim(),
        done: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
        totalSec: 0,
      };
      writeTasks((rows) => sortByName([...rows, optimistic]));
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackTasks(context?.previous);
      reportError(error, "Could not add the task.", handlers);
    },
    onSettled: settleTasks,
  });

  const update = trpc.tasks.update.useMutation({
    onMutate: async (vars) => {
      const context = await beginTaskWrite();
      writeTasks((rows) =>
        sortByName(
          rows.map((row) =>
            row.id === vars.id
              ? {
                  ...row,
                  ...(vars.name !== undefined
                    ? { name: vars.name.trim() }
                    : {}),
                  ...(vars.done !== undefined ? { done: vars.done } : {}),
                  ...(vars.archived !== undefined
                    ? { archived: vars.archived }
                    : {}),
                }
              : row,
          ),
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackTasks(context?.previous);
      reportError(error, "Could not save the task.", handlers);
    },
    onSettled: settleTasks,
  });

  const archive = trpc.tasks.archive.useMutation({
    onMutate: async (vars) => {
      const context = await beginTaskWrite();
      writeTasks((rows) =>
        rows.map((row) =>
          row.id === vars.id ? { ...row, archived: vars.archived ?? true } : row,
        ),
      );
      return context;
    },
    onError: (error, _vars, context) => {
      rollbackTasks(context?.previous);
      reportError(error, "Could not archive the task.", handlers);
    },
    onSettled: settleTasks,
  });

  const remove = trpc.tasks.remove.useMutation({
    onMutate: async (vars) => {
      const context = await beginTaskWrite();
      writeTasks((rows) => rows.filter((row) => row.id !== vars.id));
      return context;
    },
    onSuccess: (result) => {
      if (result.deleted) {
        toast.success("Task deleted.");
        return;
      }
      toast.warning(
        result.message ??
          "Archived instead — tracked time still references this task.",
      );
    },
    onError: (error, _vars, context) => {
      rollbackTasks(context?.previous);
      reportError(error, "Could not delete the task.", handlers);
    },
    onSettled: settleTasks,
  });

  return {
    createTask: (vars) =>
      create
        .mutateAsync({ ...vars, projectId, originId: ORIGIN_ID })
        .catch(() => null),
    updateTask: (vars) =>
      update.mutateAsync({ ...vars, originId: ORIGIN_ID }).catch(() => null),
    setTaskArchived: (id, archived) => {
      archive.mutate({ id, archived, originId: ORIGIN_ID });
    },
    removeTask: (id) => {
      remove.mutate({ id, originId: ORIGIN_ID });
    },
    isSaving: create.isPending || update.isPending,
  };
}
