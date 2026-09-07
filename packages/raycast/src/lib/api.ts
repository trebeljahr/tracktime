/**
 * Typed calls over the tRPC HTTP endpoints.
 *
 * Raycast cannot use the tRPC React bindings — no React Query provider, no
 * cookie jar — so it goes through `createApiClient` from `@starter/core`,
 * which speaks the same wire format with a bearer token instead.
 */
import {
  buildQuickStartInput,
  createApiClient,
  deviceTimeZone,
  type ApiClient,
  type Client,
  type DescriptionSuggestion,
  type DetailedEntry,
  type DetailedFavorite,
  type Project,
  type QuickStart,
  type Tag,
  type Task,
  type TimeEntry,
  type ResolvedSettings,
} from "@starter/core";
import { CLIENT_ID, getOriginId, getStoredSession } from "./auth.js";
import { apiUrl } from "./preferences.js";
import { loadTimerEcho, noteTimerEcho } from "./storage.js";

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

export type TagWithStats = Tag & { entryCount: number; totalSec: number };

export type StartInput = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  tagIds?: string[];
  billable?: boolean;
};

/** A block of work that was never timed — both ends are known up front. */
export type CreateInput = StartInput & { start: string; end: string };

/**
 * What to offer as an autocomplete for the description field.
 *
 * `projectId` carries the same three-way meaning the server gives it: leave it
 * out for every project, pass `null` while composing an explicitly unfiled
 * entry, pass an id to see only what has been called that under that project.
 */
export type DescriptionsInput = {
  projectId?: string | null;
  taskId?: string | null;
  search?: string;
  limit?: number;
  days?: number;
};

export type UpdateInput = {
  id: string;
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  /** Absent leaves the tags alone; `[]` clears them. */
  tagIds?: string[];
  billable?: boolean;
  start?: string;
  end?: string | null;
};

/**
 * Catalog writes.
 *
 * Every field is optional on update and absent means "leave it alone", which
 * is the server's own contract — so a rename never has to resend a rate, and
 * archiving never has to resend a name.
 */
export type CreateClientInput = { name: string; color?: string };
export type UpdateClientInput = {
  id: string;
  name?: string;
  color?: string;
  archived?: boolean;
};

export type CreateProjectInput = {
  name: string;
  color?: string;
  clientId?: string | null;
  billableDefault?: boolean;
  /** Null clears the override and falls back to the workspace rate. */
  hourlyRate?: number | null;
  estimatedHours?: number | null;
  budgetAmount?: number | null;
};
export type UpdateProjectInput = CreateProjectInput & {
  id: string;
  name?: string;
  archived?: boolean;
};

export type CreateTaskInput = { projectId: string; name: string };
export type UpdateTaskInput = {
  id: string;
  name?: string;
  done?: boolean;
  archived?: boolean;
};

export type CreateTagInput = { name: string; color?: string };
export type UpdateTagInput = {
  id: string;
  name?: string;
  color?: string;
  archived?: boolean;
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
  /** Log past work: an entry that is finished the moment it is written. */
  create(input: CreateInput): Promise<TimeEntry>;
  stop(id?: string): Promise<TimeEntry>;
  /** Throw the running entry away instead of keeping it. */
  discard(id?: string): Promise<{ success: true; id: string }>;
  /** Start a fresh timer with the same description/project/task/billable. */
  continue(id: string): Promise<TimeEntry>;
  /**
   * Start a favorite or a recent.
   *
   * Goes through `entries.start` like everything else — `buildQuickStartInput`
   * is the same builder the web tracker and the extension use, so the entry a
   * favorite opens is identical whichever client opened it.
   */
  startQuick(quick: QuickStart): Promise<TimeEntry>;
  favorites(): Promise<DetailedFavorite[]>;
  addFavorite(quick: QuickStart): Promise<DetailedFavorite>;
  removeFavorite(id: string): Promise<{ success: true; id: string }>;
  list(input: ListInput): Promise<{
    entries: DetailedEntry[];
    nextCursor?: string;
  }>;
  /** Descriptions this person has used before, newest first. */
  descriptions(input?: DescriptionsInput): Promise<DescriptionSuggestion[]>;
  update(input: UpdateInput): Promise<TimeEntry>;
  remove(id: string): Promise<{ success: true; id: string }>;
  projects(options?: {
    includeArchived?: boolean;
    clientId?: string | null;
  }): Promise<ProjectWithStats[]>;
  /** Null lists every task in the workspace, not none of them. */
  tasks(
    projectId: string | null,
    options?: { includeArchived?: boolean },
  ): Promise<TaskWithStats[]>;
  /** Tags are not scoped to a project, so this takes no project. */
  tags(options?: { includeArchived?: boolean }): Promise<TagWithStats[]>;
  clients(options?: { includeArchived?: boolean }): Promise<Client[]>;

  /**
   * Catalog rows are created and renamed from the pickers that need them, and
   * nothing else. Archiving, deleting and reordering are web app work — see
   * the extension's README — so the wrappers for them are deliberately absent
   * rather than dead.
   */
  createClient(input: CreateClientInput): Promise<Client>;
  updateClient(input: UpdateClientInput): Promise<Client>;

  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(input: UpdateProjectInput): Promise<Project>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(input: UpdateTaskInput): Promise<Task>;

  createTag(input: CreateTagInput): Promise<Tag>;
  updateTag(input: UpdateTagInput): Promise<Tag>;

  settings(): Promise<ResolvedSettings>;
};

/**
 * Record a timer transition locally the instant the server confirms it.
 *
 * Every Raycast command is its own process, so a stop performed in the Timer
 * command is invisible to the menu bar item until something crosses between
 * them. `refreshMenuBar()` is that something, and it is best effort: Raycast
 * may decline the launch, and a menu bar command that is still loaded — which
 * is exactly the state a running timer puts it in — is not remounted by one.
 * The echo does not depend on any of that. It is written here rather than in
 * each caller so a new command cannot ship without it.
 */
const echoing = async <T>(
  result: Promise<T>,
  next: (value: T) => string | null,
  /**
   * Only clear the echo when this id is the one we last saw running. Editing
   * or deleting some entry from last Tuesday says nothing about the timer
   * running right now, and "no echo yet" is not knowledge either — both skip.
   */
  clearsOnlyIf?: string,
): Promise<T> => {
  const value = await result;
  const runningId = next(value);
  if (runningId === null && clearsOnlyIf !== undefined) {
    const echo = await loadTimerEcho();
    if (echo?.runningId !== clearsOnlyIf) return value;
  }
  await noteTimerEcho(runningId);
  return value;
};

const wrap = (client: ApiClient, originId: string): Tracktime => ({
  current: () => client.query<TimeEntry | null>("entries.current"),

  start: (input) =>
    echoing(
      client.mutate<TimeEntry>("entries.start", {
        ...input,
        source: SOURCE,
        originId,
      }),
      (entry) => entry.id,
    ),

  stop: (id) =>
    echoing(
      client.mutate<TimeEntry>("entries.stop", { id, originId }),
      () => null,
    ),

  discard: (id) =>
    echoing(
      client.mutate<{ success: true; id: string }>("entries.discard", {
        id,
        originId,
      }),
      () => null,
    ),

  continue: (id) =>
    echoing(
      client.mutate<TimeEntry>("entries.continue", { id, originId }),
      (entry) => entry.id,
    ),

  startQuick: (quick) =>
    echoing(
      client.mutate<TimeEntry>(
        "entries.start",
        buildQuickStartInput(quick, {
          source: SOURCE,
          timeZone: deviceTimeZone(),
          originId,
        }),
      ),
      (entry) => entry.id,
    ),

  // No echo: a manual entry is already finished, so it says nothing about
  // what is running — and the server does not touch the running timer to
  // write one. Clearing the echo here would blank a menu bar that is right.
  create: (input) =>
    client.mutate<TimeEntry>("entries.create", {
      ...input,
      source: SOURCE,
      timeZone: deviceTimeZone(),
      originId,
    }),

  favorites: () => client.query<DetailedFavorite[]>("favorites.list"),

  addFavorite: (quick) =>
    client.mutate<DetailedFavorite>("favorites.create", { ...quick, originId }),

  removeFavorite: (id) =>
    client.mutate<{ success: true; id: string }>("favorites.remove", {
      id,
      originId,
    }),

  list: (input) =>
    client.query<{ entries: DetailedEntry[]; nextCursor?: string }>(
      "entries.list",
      input,
    ),

  // An edit can end the running entry, and deleting one certainly does. Both
  // echo only when the entry they touched is the one this install last saw
  // running — an edit to last Tuesday must not clear today's menu bar.
  descriptions: (input) =>
    client.query<DescriptionSuggestion[]>("entries.descriptions", input ?? {}),

  update: (input) =>
    echoing(
      client.mutate<TimeEntry>("entries.update", { ...input, originId }),
      (entry) => (entry.end === null ? entry.id : null),
      input.id,
    ),

  remove: (id) =>
    echoing(
      client.mutate<{ success: true; id: string }>("entries.remove", {
        id,
        originId,
      }),
      () => null,
      id,
    ),

  projects: (options) =>
    client.query<ProjectWithStats[]>("projects.list", {
      includeArchived: options?.includeArchived ?? false,
      ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
    }),

  tasks: (projectId, options) =>
    client.query<TaskWithStats[]>("tasks.list", {
      projectId,
      includeArchived: options?.includeArchived ?? false,
    }),

  tags: (options) =>
    client.query<TagWithStats[]>("tags.list", {
      includeArchived: options?.includeArchived ?? false,
    }),

  clients: (options) =>
    client.query<Client[]>("clients.list", {
      includeArchived: options?.includeArchived ?? false,
    }),

  createClient: (input) =>
    client.mutate<Client>("clients.create", { ...input, originId }),
  updateClient: (input) =>
    client.mutate<Client>("clients.update", { ...input, originId }),

  createProject: (input) =>
    client.mutate<Project>("projects.create", { ...input, originId }),
  updateProject: (input) =>
    client.mutate<Project>("projects.update", { ...input, originId }),

  createTask: (input) =>
    client.mutate<Task>("tasks.create", { ...input, originId }),
  updateTask: (input) =>
    client.mutate<Task>("tasks.update", { ...input, originId }),

  createTag: (input) =>
    client.mutate<Tag>("tags.create", { ...input, originId }),
  updateTag: (input) =>
    client.mutate<Tag>("tags.update", { ...input, originId }),

  settings: () => client.query<ResolvedSettings>("settings.get"),
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
