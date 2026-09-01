/**
 * Typed calls over the tRPC HTTP endpoints.
 *
 * Raycast cannot use the tRPC React bindings — no React Query provider, no
 * cookie jar — so it goes through `createApiClient` from `@starter/core`,
 * which speaks the same wire format with a bearer token instead.
 */
import {
  createApiClient,
  type ApiClient,
  type DetailedEntry,
  type Project,
  type Task,
  type TimeEntry,
  type WorkspaceSettings,
} from "@starter/core";
import { CLIENT_ID, getOriginId, getStoredSession } from "./auth.js";
import { apiUrl } from "./preferences.js";

/** Thrown when no token is stored — the caller should offer to sign in. */
export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in to tracktime");
    this.name = "NotSignedInError";
  }
}

/** Entries written from here are tagged so reports can tell them apart. */
const SOURCE = "api" as const;

export type ProjectWithStats = Project & {
  clientName: string | null;
  clientColor: string | null;
  entryCount: number;
  totalSec: number;
};

export type TaskWithStats = Task & { totalSec: number };

export type StartInput = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
};

export type UpdateInput = {
  id: string;
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  start?: string;
  end?: string | null;
};

export type ListInput = {
  from: string;
  to: string;
  search?: string;
  limit?: number;
  cursor?: string;
};

export type Tracktime = {
  /** The running entry, or null when the timer is stopped. */
  current(): Promise<TimeEntry | null>;
  start(input: StartInput): Promise<TimeEntry>;
  stop(id?: string): Promise<TimeEntry>;
  /** Throw the running entry away instead of keeping it. */
  discard(id?: string): Promise<{ success: true; id: string }>;
  /** Start a fresh timer with the same description/project/task/billable. */
  continue(id: string): Promise<TimeEntry>;
  list(input: ListInput): Promise<{
    entries: DetailedEntry[];
    nextCursor?: string;
  }>;
  update(input: UpdateInput): Promise<TimeEntry>;
  remove(id: string): Promise<{ success: true; id: string }>;
  projects(): Promise<ProjectWithStats[]>;
  tasks(projectId: string): Promise<TaskWithStats[]>;
  settings(): Promise<WorkspaceSettings>;
};

const wrap = (client: ApiClient, originId: string): Tracktime => ({
  current: () => client.query<TimeEntry | null>("entries.current"),

  start: (input) =>
    client.mutate<TimeEntry>("entries.start", {
      ...input,
      source: SOURCE,
      originId,
    }),

  stop: (id) => client.mutate<TimeEntry>("entries.stop", { id, originId }),

  discard: (id) =>
    client.mutate<{ success: true; id: string }>("entries.discard", {
      id,
      originId,
    }),

  continue: (id) =>
    client.mutate<TimeEntry>("entries.continue", { id, originId }),

  list: (input) =>
    client.query<{ entries: DetailedEntry[]; nextCursor?: string }>(
      "entries.list",
      input,
    ),

  update: (input) =>
    client.mutate<TimeEntry>("entries.update", { ...input, originId }),

  remove: (id) =>
    client.mutate<{ success: true; id: string }>("entries.remove", {
      id,
      originId,
    }),

  projects: () =>
    client.query<ProjectWithStats[]>("projects.list", { includeArchived: false }),

  tasks: (projectId) =>
    client.query<TaskWithStats[]>("tasks.list", {
      projectId,
      includeArchived: false,
    }),

  settings: () => client.query<WorkspaceSettings>("settings.get"),
});

/**
 * Build a caller bound to the stored session.
 *
 * Throws {@link NotSignedInError} when there is no token, which every command
 * turns into "run Sign in to tracktime" rather than a raw failure toast.
 */
export async function getTracktime(): Promise<Tracktime> {
  const session = await getStoredSession();
  if (!session) throw new NotSignedInError();

  const client = createApiClient({
    baseUrl: apiUrl(),
    token: session.token,
    clientId: CLIENT_ID,
  });

  return wrap(client, await getOriginId());
}
