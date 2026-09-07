// "Does this id address something in this workspace?" — asked before a write
// is allowed to reference it.
//
// Every miss answers NOT_FOUND, never FORBIDDEN. A FORBIDDEN would confirm
// that the id exists somewhere, which is exactly the fact a cross-workspace
// probe is fishing for.
import { TRPCError } from "@trpc/server";
import mongoose from "mongoose";
import { Client } from "../../models/Client.js";
import { Project } from "../../models/Project.js";
import { Task, type TaskDocLike } from "../../models/Task.js";

/**
 * Ids cross the wire as opaque strings, so a malformed one must not blow up
 * as a Mongoose CastError — it is simply not found.
 */
export function assertObjectId(id: string): string {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  return id;
}

/** Throws NOT_FOUND when the client is missing or owned by somebody else. */
export async function assertClientOwned(
  workspaceId: string,
  clientId: string,
): Promise<void> {
  assertObjectId(clientId);
  const exists = await Client.exists({ _id: clientId, workspaceId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

/** Throws NOT_FOUND when the project is missing or owned by somebody else. */
export async function assertProjectOwned(
  workspaceId: string,
  projectId: string,
): Promise<void> {
  assertObjectId(projectId);
  const exists = await Project.exists({ _id: projectId, workspaceId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

/** Loads a task scoped to its workspace, or throws NOT_FOUND. */
export async function findOwnedTask(
  workspaceId: string,
  id: string,
): Promise<TaskDocLike> {
  assertObjectId(id);
  const task = await Task.findOne({ _id: id, workspaceId }).lean();
  if (!task) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}
