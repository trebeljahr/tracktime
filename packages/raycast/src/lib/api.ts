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
  type DetailedEntry,
  type DetailedFavorite,
  type Project,
  type QuickStart,
  type RecentEntry,
  type Tag,
  type Task,
  type TimeEntry,
  type ResolvedSettings,
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

export type TagWithStats = Tag & { entryCount: number; totalSec: number };

export type StartInput = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  tagIds?: string[];
  billable?: boolean;
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
  /**
   * Start a favorite or a recent.
   *
   * Goes through `entries.start` like everything else — `buildQuickStartInput`
   * is the same builder the web tracker and the extension use, so the entry a
   * favorite opens is identical whichever client opened it.
   */
  startQuick(quick: QuickStart): Promise<TimeEntry>;
  favorites(): Promise<DetailedFavorite[]>;
  recents(input?: { limit?: number; days?: number }): Promise<RecentEntry[]>;
  addFavorite(quick: QuickStart): Promise<DetailedFavorite>;
  removeFavorite(id: string): Promise<{ success: true; id: string }>;
  list(input: ListInput): Promise<{
    entries: DetailedEntry[];
    nextCursor?: string;
  }>;
  update(input: UpdateInput): Promise<TimeEntry>;
  remove(id: string): Promise<{ success: true; id: string }>;
  projects(): Promise<ProjectWithStats[]>;
  tasks(projectId: string): Promise<TaskWithStats[]>;
  /** Tags are not scoped to a project, so this takes no argument. */
  tags(): Promise<TagWithStats[]>;
  settings(): Promise<ResolvedSettings>;
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

  startQuick: (quick) =>
    client.mutate<TimeEntry>(
      "entries.start",
      buildQuickStartInput(quick, {
        source: SOURCE,
        timeZone: deviceTimeZone(),
        originId,
      }),
    ),

  favorites: () => client.query<DetailedFavorite[]>("favorites.list"),

  recents: (input) =>
    client.query<RecentEntry[]>("entries.recent", input ?? {}),

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

  tags: () =>
    client.query<TagWithStats[]>("tags.list", { includeArchived: false }),

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
