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
import { protectedProcedure, router } from "../trpc.js";
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
  ownerId: string,
  projectId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Task.exists({
    ownerId,
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
  ownerId: string,
  projectId: string,
): Promise<void> {
  assertObjectId(projectId);
  const exists = await Project.exists({ _id: projectId, ownerId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

/** Loads a task scoped to its owner, or throws NOT_FOUND. */
async function findOwnedTask(ownerId: string, id: string): Promise<TaskDocLike> {
  assertObjectId(id);
  const task = await Task.findOne({ _id: id, ownerId }).lean();
  if (!task) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}

export const tasksRouter = router({
  list: protectedProcedure
    .input(taskListSchema)
    .query(async ({ ctx, input }): Promise<TaskWithStats[]> => {
      const ownerId = ctx.user.id;
      if (typeof input.projectId === "string") assertObjectId(input.projectId);

      const rows = await Task.aggregate<TaskAggregateRow>([
        {
          $match: {
            ownerId,
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
                      { $eq: ["$ownerId", ownerId] },
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

  create: protectedProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      const name = input.name.trim();
      await assertProjectOwned(ctx.user.id, input.projectId);
      await assertUniqueTaskName(ctx.user.id, input.projectId, name);

      const created = await Task.create({
        ownerId: ctx.user.id,
        projectId: input.projectId,
        name,
        done: false,
        archived: false,
      });

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(created);
    }),

  update: protectedProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      const existing = await findOwnedTask(ctx.user.id, input.id);
      if (input.name !== undefined) {
        await assertUniqueTaskName(
          ctx.user.id,
          existing.projectId,
          input.name,
          input.id,
        );
      }

      const updated = await Task.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
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

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(updated);
    }),

  archive: protectedProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      assertObjectId(input.id);

      const updated = await Task.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "task" },
        input.originId,
      );
      return toClientTask(updated);
    }),

  /**
   * Always deletes. Entries booked on the task keep their tracked time and
   * their project, and simply fall back to "no task".
   */
  remove: protectedProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      await findOwnedTask(ctx.user.id, input.id);

      const result = await cascadeDeleteTask(ctx.user.id, input.id);

      publishSync(
        ctx.user.id,
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
