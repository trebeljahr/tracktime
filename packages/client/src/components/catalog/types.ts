import type {
  Client,
  CreateClientInput,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  Task,
  UpdateClientInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@starter/shared";

// The router's own output types live behind `@starter/server/trpc`, which
// only re-exports `AppRouter`; `inferRouterOutputs` would need `@trpc/server`
// as a client dependency. These mirror the catalog routers' return shapes
// structurally instead, so `setData` still type-checks against the cache.

/** A project joined with its client and rolled-up time totals. */
export type ProjectRow = Project & {
  clientName: string | null;
  clientColor: string | null;
  /** Number of time entries booked on this project. */
  entryCount: number;
  /** Sum of `durationSec` across those entries. */
  totalSec: number;
};

/** A bare client, as returned by `clients.list`. */
export type ClientRow = Client;

/** A task plus its tracked seconds. */
export type TaskRow = Task & { totalSec: number };

/** What every catalog `remove` resolves to — deletion is never guaranteed. */
export type RemoveResult = {
  deleted: boolean;
  archived: boolean;
  message: string | null;
};

// Mutation results are the bare documents — no joins, no rolled-up totals.
export type CreatedProject = Project;
export type CreatedClient = Client;
export type CreatedTask = Task;

// `originId` is stamped by the mutation hooks, never by a caller.
export type CreateProjectVars = Omit<CreateProjectInput, "originId">;
export type UpdateProjectVars = Omit<UpdateProjectInput, "originId">;
export type CreateClientVars = Omit<CreateClientInput, "originId">;
export type UpdateClientVars = Omit<UpdateClientInput, "originId">;
export type CreateTaskVars = Omit<CreateTaskInput, "originId" | "projectId">;
export type UpdateTaskVars = Omit<UpdateTaskInput, "originId">;

/**
 * The catalog screen always asks for everything (archived included) and
 * filters in the browser. One canonical cache key per resource keeps the
 * optimistic `setData` calls deterministic — no key has to be guessed from
 * whatever filter the user happens to have toggled.
 */
export const PROJECT_LIST_INPUT: { includeArchived: boolean } = {
  includeArchived: true,
};

export const CLIENT_LIST_INPUT: { includeArchived: boolean } = {
  includeArchived: true,
};

export const taskListInput = (
  projectId: string,
): { projectId: string; includeArchived: boolean } => ({
  projectId,
  includeArchived: true,
});

/** Mirrors the server's case-insensitive name sort. */
export function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** tRPC error codes arrive on `error.data.code`; narrow without `any`. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return fallback;
}

/** Duplicate names come back as CONFLICT and belong inline on the field. */
export function isConflict(error: unknown): boolean {
  return errorCode(error) === "CONFLICT";
}
