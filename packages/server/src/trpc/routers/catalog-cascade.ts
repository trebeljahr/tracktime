// Cascading deletes for the catalog (Client → Project → Task).
//
// Deleting a catalog row never deletes tracked time. Entries keep their
// start/end/duration and simply lose the reference — `TimeEntry.projectId`
// and `TimeEntry.taskId` are both nullable precisely so a "project-less"
// entry is a normal, representable state. The same holds one level up: a
// project whose client is deleted keeps its time and becomes client-less.
import type { CatalogRemoveResult } from "@starter/shared";
import { Client } from "../../models/Client.js";
import { Favorite } from "../../models/Favorite.js";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TimeEntry } from "../../models/TimeEntry.js";

/** Re-exported: every catalog router imports the shape from here. */
export type { CatalogRemoveResult };

const EMPTY_RESULT: CatalogRemoveResult = {
  entriesDetached: 0,
  tasksDeleted: 0,
  projectsDetached: 0,
  favoritesDetached: 0,
};

/**
 * Delete a project: its tasks go with it, and every entry that pointed at
 * either the project or one of those tasks is detached from both.
 */
export async function cascadeDeleteProject(
  workspaceId: string,
  projectId: string,
): Promise<CatalogRemoveResult> {
  const tasks = await Task.find({ workspaceId, projectId })
    .select({ _id: 1 })
    .lean();
  const taskIds = tasks.map((task) => String(task._id));

  // An entry carrying a task always carries that task's project too, but
  // matching on both keeps the cascade correct even if that ever drifts.
  const detached = await TimeEntry.updateMany(
    {
      workspaceId,
      $or: [
        { projectId },
        ...(taskIds.length > 0 ? [{ taskId: { $in: taskIds } }] : []),
      ],
    },
    { $set: { projectId: null, taskId: null } },
  );

  // Favorites are detached, not deleted, for the same reason entries are: a
  // pin is a statement about work the user does, and losing the project it was
  // filed under is no reason to silently unpin it. It degrades to a
  // project-less pin, which every surface already renders.
  const favorites = await Favorite.updateMany(
    {
      workspaceId,
      $or: [
        { projectId },
        ...(taskIds.length > 0 ? [{ taskId: { $in: taskIds } }] : []),
      ],
    },
    { $set: { projectId: null, taskId: null } },
  );

  await Task.deleteMany({ workspaceId, projectId });
  await Project.deleteOne({ _id: projectId, workspaceId });

  return {
    ...EMPTY_RESULT,
    entriesDetached: detached.modifiedCount,
    tasksDeleted: taskIds.length,
    favoritesDetached: favorites.modifiedCount,
  };
}

/**
 * Delete a task. Entries booked on it keep their project and fall back to
 * "no task".
 */
export async function cascadeDeleteTask(
  workspaceId: string,
  taskId: string,
): Promise<CatalogRemoveResult> {
  const detached = await TimeEntry.updateMany(
    { workspaceId, taskId },
    { $set: { taskId: null } },
  );
  const favorites = await Favorite.updateMany(
    { workspaceId, taskId },
    { $set: { taskId: null } },
  );
  await Task.deleteOne({ _id: taskId, workspaceId });

  return {
    ...EMPTY_RESULT,
    entriesDetached: detached.modifiedCount,
    favoritesDetached: favorites.modifiedCount,
  };
}

/**
 * Delete a client. Its projects survive — they are detached, not deleted, so
 * no tracked time is orphaned by removing a grouping level above it.
 */
export async function cascadeDeleteClient(
  workspaceId: string,
  clientId: string,
): Promise<CatalogRemoveResult> {
  const detached = await Project.updateMany(
    { workspaceId, clientId },
    { $set: { clientId: null } },
  );
  await Client.deleteOne({ _id: clientId, workspaceId });

  return { ...EMPTY_RESULT, projectsDetached: detached.modifiedCount };
}
