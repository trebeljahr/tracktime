// The pure half of favorites and recents: turning catalog rows into labels,
// and turning a page of time entries into the distinct things worth
// restarting. Both are deliberately free of mongoose so they can be tested
// directly, which is where the rules that actually bite live — what counts as
// "the same job", which of several copies wins, and what a pin pointing at an
// archived or deleted project renders as.
import {
  emptyQuickStartLabels,
  quickStartKey,
  type QuickStartLabels,
  type RecentEntry,
} from "@starter/shared";

/** The fields a project contributes to a quick start's labels. */
export type CatalogProject = {
  name: string;
  color: string;
  clientId: string | null;
  archived: boolean;
};

/** The fields a task contributes. */
export type CatalogTask = { name: string; projectId: string };

/** Everything the label resolver may look at, keyed by id. */
export type CatalogLookup = {
  projects: ReadonlyMap<string, CatalogProject>;
  tasks: ReadonlyMap<string, CatalogTask>;
  clients: ReadonlyMap<string, string>;
};

/** A quick start's references, as far as labelling is concerned. */
export type QuickStartRefs = {
  projectId: string | null;
  taskId: string | null;
};

export const emptyCatalog = (): CatalogLookup => ({
  projects: new Map(),
  tasks: new Map(),
  clients: new Map(),
});

/**
 * Resolve the catalog labels for one quick start.
 *
 * The two failure modes are kept apart on purpose. A row pointing at a project
 * that is *gone* gets `projectMissing` and no name, so the client renders
 * "Project deleted" rather than a hex id nobody can read. A row pointing at an
 * *archived* project keeps its real name and is merely flagged — the work was
 * real, the project is only retired, and blanking it would lose more than it
 * protects.
 */
export const resolveQuickStartLabels = (
  refs: QuickStartRefs,
  catalog: CatalogLookup,
): QuickStartLabels => {
  const labels = emptyQuickStartLabels();

  if (refs.projectId !== null) {
    const project = catalog.projects.get(refs.projectId);
    if (project === undefined) {
      labels.projectMissing = true;
    } else {
      labels.projectName = project.name;
      labels.projectColor = project.color;
      labels.projectArchived = project.archived;
      labels.clientName =
        project.clientId === null
          ? null
          : catalog.clients.get(project.clientId) ?? null;
    }
  }

  if (refs.taskId !== null) {
    const task = catalog.tasks.get(refs.taskId);
    if (task === undefined) labels.taskMissing = true;
    else labels.taskName = task.name;
  }

  return labels;
};

/** The entry fields {@link collapseRecents} reads. */
export type RecentSourceEntry = {
  id: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  /** ISO datetime. */
  start: string;
  /** null while running. */
  end: string | null;
};

/**
 * Newest first, ties broken by id descending — the same total order
 * `entries.list` sorts by, so "the most recent one" means the same thing in
 * both places even for entries that share a start instant.
 */
const byRecency = (a: RecentSourceEntry, b: RecentSourceEntry): number => {
  const delta = Date.parse(b.start) - Date.parse(a.start);
  if (delta !== 0) return delta;
  return b.id.localeCompare(a.id);
};

/**
 * Fold a page of entries into the distinct combinations worth restarting.
 *
 * The running entry is skipped. Offering to "start" what is already running
 * would stop it and open an identical copy, shredding one stretch of work into
 * fragments — the same reason an entry row renders Stop instead of Continue.
 *
 * Sorting happens here rather than being assumed of the caller: the ordering
 * *is* the feature ("the five things you actually track, most recent first"),
 * so it belongs somewhere it can be tested.
 */
export const collapseRecents = (
  entries: readonly RecentSourceEntry[],
  catalog: CatalogLookup,
  limit: number,
): RecentEntry[] => {
  const byKey = new Map<string, RecentEntry>();

  for (const entry of [...entries].sort(byRecency)) {
    if (entry.end === null) continue;
    if (!Number.isFinite(Date.parse(entry.start))) continue;

    const quick = {
      description: entry.description.trim(),
      projectId: entry.projectId,
      taskId: entry.taskId,
      billable: entry.billable,
    };
    const key = quickStartKey(quick);

    const seen = byKey.get(key);
    if (seen !== undefined) {
      // Every copy counts, but only the newest one supplies the timestamps —
      // insertion order is already newest-first, so the first win stands.
      seen.count += 1;
      continue;
    }

    byKey.set(key, {
      ...quick,
      ...resolveQuickStartLabels(quick, catalog),
      key,
      lastStart: entry.start,
      lastEntryId: entry.id,
      count: 1,
    });
  }

  // Map iteration is insertion order, which is already the sorted order above.
  return [...byKey.values()].slice(0, Math.max(0, limit));
};
