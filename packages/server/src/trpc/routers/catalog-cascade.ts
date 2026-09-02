// Cascading deletes for the catalog (Client → Project → Task).
//
// Deleting a catalog row never deletes tracked time. Entries keep their
// start/end/duration and simply lose the reference — `TimeEntry.projectId`
// and `TimeEntry.taskId` are both nullable precisely so a "project-less"
// entry is a normal, representable state. The same holds one level up: a
// project whose client is deleted keeps its time and becomes client-less.
import { Client } from "../../models/Client.js";
import { Favorite } from "../../models/Favorite.js";
import { Project } from "../../models/Project.js";
import { Task } from "../../models/Task.js";
import { TimeEntry } from "../../models/TimeEntry.js";

/**
 * What every catalog `remove` resolves to. Deletion always happens; the
 * counts describe the collateral so the UI can report it honestly.
 */
export type CatalogRemoveResult = {
  /** Time entries that kept their time but lost a project/task reference. */
  entriesDetached: number;
  /** Tasks deleted along with their project. */
  tasksDeleted: number;
  /** Projects that kept their time but lost their client reference. */
  projectsDetached: number;
  /** Pinned quick starts that lost a project/task reference. */
  favoritesDetached: number;
};

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
  ownerId: string,
  projectId: string,
): Promise<CatalogRemoveResult> {
  const tasks = await Task.find({ ownerId, projectId })
    .select({ _id: 1 })
    .lean();
  const taskIds = tasks.map((task) => String(task._id));

  // An entry carrying a task always carries that task's project too, but
  // matching on both keeps the cascade correct even if that ever drifts.
  const detached = await TimeEntry.updateMany(
    {
      ownerId,
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
      ownerId,
      $or: [
        { projectId },
        ...(taskIds.length > 0 ? [{ taskId: { $in: taskIds } }] : []),
      ],
    },
    { $set: { projectId: null, taskId: null } },
  );

  await Task.deleteMany({ ownerId, projectId });
  await Project.deleteOne({ _id: projectId, ownerId });

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
  ownerId: string,
  taskId: string,
): Promise<CatalogRemoveResult> {
  const detached = await TimeEntry.updateMany(
    { ownerId, taskId },
    { $set: { taskId: null } },
  );
  const favorites = await Favorite.updateMany(
    { ownerId, taskId },
    { $set: { taskId: null } },
  );
  await Task.deleteOne({ _id: taskId, ownerId });

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
  ownerId: string,
  clientId: string,
): Promise<CatalogRemoveResult> {
  const detached = await Project.updateMany(
    { ownerId, clientId },
    { $set: { clientId: null } },
  );
  await Client.deleteOne({ _id: clientId, ownerId });

  return { ...EMPTY_RESULT, projectsDetached: detached.modifiedCount };
}
