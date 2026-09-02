/**
 * Reading and creating the catalog the popup picks from: clients, projects,
 * tasks.
 *
 * Creation exists here so the toolbar is not a dead end. Wanting to track
 * against a project that does not exist yet is the ordinary case at the start
 * of a piece of work, and having to open the web app to make one — while the
 * thing you meant to time is already running — defeats the point of a toolbar
 * button.
 *
 * Every mutation carries this worker's `ORIGIN_ID`, so the `catalog.changed`
 * event it triggers comes back tagged as ours and is ignored rather than
 * re-applied.
 */
import type { ApiClient, Client, Project, Tag, Task } from "@starter/core";
import {
  ensureReady,
  ORIGIN_ID,
  getCachedClients,
  getCachedTags,
  setCachedTags,
  getCachedTasks,
  setCachedClients,
  setCachedProjects,
  setCachedTasks,
} from "./runtime";

/**
 * Tags are unscoped — they hang off the entry, not off a project — so unlike
 * tasks they can be fetched once and offered whatever else is picked.
 *
 * `tags.list` also answers with per-tag roll-ups. They are simply ignored:
 * typing the result as `Tag` reads the fields the popup renders and leaves the
 * rest alone, the same way the project and client fetches do.
 */
export const fetchTags = async (api: ApiClient): Promise<Tag[]> => {
  const tags = await api.query<Tag[]>("tags.list", { includeArchived: false });
  setCachedTags(tags);
  return tags;
};

export async function createTag(name: string): Promise<Tag> {
  const current = await ensureReady();
  const created = await current.api.mutate<Tag>("tags.create", {
    name: name.trim(),
    originId: ORIGIN_ID,
  });
  // Appended rather than invalidated: the popup is mid-flow and about to
  // render this list, and a refetch would blank the picker for a beat.
  setCachedTags([...(getCachedTags() ?? []), created]);
  return created;
}

export const fetchProjects = async (api: ApiClient): Promise<Project[]> => {
  const projects = await api.query<Project[]>("projects.list", {
    includeArchived: false,
  });
  setCachedProjects(projects);
  return projects;
};

export const fetchClients = async (api: ApiClient): Promise<Client[]> => {
  const clients = await api.query<Client[]>("clients.list", {
    includeArchived: false,
  });
  setCachedClients(clients);
  return clients;
};

/**
 * Tasks for one project. `null` means no project is selected, which is a real
 * state — an entry need not belong to a project — and yields no tasks rather
 * than a request for tasks of nothing.
 */
export const fetchTasks = async (
  api: ApiClient,
  projectId: string | null,
): Promise<Task[]> => {
  if (projectId === null) return [];

  const cached = getCachedTasks(projectId);
  if (cached !== null) return cached;

  const tasks = await api.query<Task[]>("tasks.list", {
    projectId,
    includeArchived: false,
  });
  setCachedTasks(projectId, tasks);
  return tasks;
};

/** Load the tasks for a project into the cache, so the next state carries them. */
export async function selectProjectTasks(
  projectId: string | null,
): Promise<void> {
  const current = await ensureReady();
  if (!current.session) return;
  await fetchTasks(current.api, projectId);
}

export async function createClient(name: string): Promise<Client> {
  const current = await ensureReady();
  const created = await current.api.mutate<Client>("clients.create", {
    name: name.trim(),
    originId: ORIGIN_ID,
  });
  // Append rather than invalidate: the popup is mid-flow and about to render
  // this list, and a refetch would blank the picker for a beat.
  setCachedClients([...(getCachedClients() ?? []), created]);
  return created;
}

export async function createProject(
  name: string,
  clientId: string | null,
): Promise<Project> {
  const current = await ensureReady();
  const created = await current.api.mutate<Project>("projects.create", {
    name: name.trim(),
    clientId,
    originId: ORIGIN_ID,
  });
  // Refetched rather than appended: the server assigns the colour and applies
  // the workspace's billable default, so the row it returns is the truth and
  // the list order is the server's collation, not ours.
  await fetchProjects(current.api);
  return created;
}

export async function createTask(
  projectId: string,
  name: string,
): Promise<Task> {
  const current = await ensureReady();
  const created = await current.api.mutate<Task>("tasks.create", {
    projectId,
    name: name.trim(),
    originId: ORIGIN_ID,
  });
  setCachedTasks(projectId, [...(getCachedTasks(projectId) ?? []), created]);
  return created;
}
