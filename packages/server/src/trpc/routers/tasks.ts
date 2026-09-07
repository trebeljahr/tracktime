// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// Tasks are a flat, workspace-wide catalog — an entry carries a task and a
// project side by side, and the task belongs to neither the project nor the
// client above it. `list` rolls up tracked seconds per task in one aggregation
// so the Tasks screen never fires a query per row.
import { TRPCError } from "@trpc/server";
import {
  createTaskSchema,
  idInputSchema,
  taskListSchema,
  updateTaskSchema,
  type Task as TaskWire,
} from "@starter/shared";
import { Task, toClientTask, type TaskDocLike } from "../../models/Task.js";
import { publishSync } from "../../ws/sync.js";
import { workspaceProcedure, router } from "../trpc.js";
import {
  cascadeDeleteTask,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";
import { archiveInputSchema, assertObjectId, exactNameRegExp } from "./clients.js";

/** A task plus its rolled-up tracked time. */
export type TaskWithStats = TaskWire & {
  /** Sum of `durationSec` across entries booked on this task. */
  totalSec: number;
};

/** Raw shape produced by the `list` aggregation. */
type TaskAggregateRow = TaskDocLike & {
  stats: { totalSec: number }[];
};

async function assertUniqueTaskName(
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Task.exists({
    workspaceId,
    name: exactNameRegExp(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A task named "${name.trim()}" already exists.`,
    });
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

      const rows = await Task.aggregate<TaskAggregateRow>([
        {
          $match: {
            workspaceId,
            ...(input.includeArchived ? {} : { archived: false }),
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
        { $addFields: { sortName: { $toLower: "$name" } } },
        { $sort: { sortName: 1 } },
      ]);

      return rows.map((row) => ({
        ...toClientTask(row),
        totalSec: row.stats[0]?.totalSec ?? 0,
      }));
    }),

  create: workspaceProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> => {
      const name = input.name.trim();
      await assertUniqueTaskName(ctx.workspaceId, name);

      const created = await Task.create({
        workspaceId: ctx.workspaceId,
        createdBy: ctx.user.id,
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
      await findOwnedTask(ctx.workspaceId, input.id);
      if (input.name !== undefined) {
        await assertUniqueTaskName(ctx.workspaceId, input.name, input.id);
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
