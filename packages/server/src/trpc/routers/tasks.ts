// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// Tasks always live under a project. `list` rolls up tracked seconds per task
// in one aggregation so the projects screen never fires a query per row.
import { TRPCError } from "@trpc/server";
import {
  createTaskSchema,
  idInputSchema,
  taskListSchema,
  updateTaskSchema,
  type Task as TaskWire,
} from "@starter/shared";
import { Project } from "../../models/Project.js";
import { Task, toClientTask, type TaskDocLike } from "../../models/Task.js";
import { publishSync } from "../../ws/sync.js";
import { workspaceProcedure, router } from "../trpc.js";
import {
  cascadeDeleteTask,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";
import { archiveInputSchema, assertObjectId, exactNameRegExp } from "./clients.js";

/** A task plus its owning project and rolled-up tracked time. */
export type TaskWithStats = TaskWire & {
  projectName: string | null;
  projectColor: string | null;
  /** Sum of `durationSec` across entries booked on this task. */
  totalSec: number;
};

/** Raw shape produced by the `list` aggregation. */
type TaskAggregateRow = TaskDocLike & {
  projectDoc: { name: string; color: string }[];
  stats: { totalSec: number }[];
};

async function assertUniqueTaskName(
  workspaceId: string,
  projectId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Task.exists({
    workspaceId,
    projectId,
    name: exactNameRegExp(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This project already has a task named "${name.trim()}".`,
    });
  }
}

/** Throws NOT_FOUND when the project is missing or owned by somebody else. */
async function assertProjectOwned(
  workspaceId: string,
  projectId: string,
): Promise<void> {
  assertObjectId(projectId);
  const exists = await Project.exists({ _id: projectId, workspaceId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

/** Loads a task scoped to its owner, or throws NOT_FOUND. */
async function findOwnedTask(workspaceId: string, id: string): Promise<TaskDocLike> {
  assertObjectId(id);
  const task = await Task.findOne({ _id: id, workspaceId }).lean();
  if (!task) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}

export const tasksRouter = router({
  list: workspaceProcedure
    .input(taskListSchema)
    .query(async ({ ctx, input }): Promise<TaskWithStats[]> => {
      const workspaceId = ctx.workspaceId;
      if (typeof input.projectId === "string") assertObjectId(input.projectId);

      const rows = await Task.aggregate<TaskAggregateRow>([
        {
          $match: {
            workspaceId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.includeArchived ? {} : { archived: false }),
          },
        },
        {
          // Archived projects must still resolve, so this joins by id only.
          $lookup: {
            from: "projects",
            let: { pid: "$projectId" },
            pipeline: [
              { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$pid"] } } },
              { $project: { _id: 0, name: 1, color: 1 } },
            ],
            as: "projectDoc",
          },
        },
        {
          $lookup: {
            from: "timeentries",
            let: { tid: { $toString: "$_id" } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$workspaceId", workspaceId] },
                      { $eq: ["$taskId", "$$tid"] },
                    ],
                  },
                },
              },
              { $group: { _id: null, totalSec: { $sum: "$durationSec" } } },
              { $project: { _id: 0, totalSec: 1 } },
            ],
            as: "stats",
          },
        },
        {
          $addFields: {
            sortName: { $toLower: "$name" },
            // Unscoped listings group by project first; within one project the
            // extra key is constant, so the same sort serves both callers.
            sortProject: {
              $toLower: {
                $ifNull: [{ $first: "$projectDoc.name" }, ""],
              },
            },
          },
        },
        { $sort: { sortProject: 1, sortName: 1 } },
      ]);

      return rows.map((row) => {
        const project = row.projectDoc[0];
        return {
          ...toClientTask(row),
          projectName: project?.name ?? null,
          projectColor: project?.color ?? null,
          totalSec: row.stats[0]?.totalSec ?? 0,
        };
      });
    }),

  create: workspaceProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      const name = input.name.trim();
      await assertProjectOwned(ctx.workspaceId, input.projectId);
      await assertUniqueTaskName(ctx.workspaceId, input.projectId, name);

      const created = await Task.create({
        workspaceId: ctx.workspaceId,
        createdBy: ctx.user.id,
        projectId: input.projectId,
        name,
        done: false,
        archived: false,
      });

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(created);
    }),

  update: workspaceProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      const existing = await findOwnedTask(ctx.workspaceId, input.id);
      if (input.name !== undefined) {
        await assertUniqueTaskName(
          ctx.workspaceId,
          existing.projectId,
          input.name,
          input.id,
        );
      }

      const updated = await Task.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
        {
          $set: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.done !== undefined ? { done: input.done } : {}),
            ...(input.archived !== undefined
              ? { archived: input.archived }
              : {}),
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(updated);
    }),

  archive: workspaceProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      assertObjectId(input.id);

      const updated = await Task.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(updated);
    }),

  /**
   * Always deletes. Entries booked on the task keep their tracked time and
   * their project, and simply fall back to "no task".
   */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      await findOwnedTask(ctx.workspaceId, input.id);

      const result = await cascadeDeleteTask(ctx.workspaceId, input.id);

      void publishSync(
        ctx.workspaceId,
        {
          kind: "catalog.changed",
          scope: "task",
          entriesTouched: result.entriesDetached > 0,
        },
        input.originId,
      );
      // A detached pin still points somewhere it did not a moment ago, and
      // `catalog.changed` does not cover the favorites cache.
      if (result.favoritesDetached > 0) {
        publishSync(
          ctx.user.id,
          { kind: "favorites.changed" },
          input.originId,
        );
      }
      return result;
    }),
});
