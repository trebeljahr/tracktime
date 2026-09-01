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
import { TimeEntry } from "../../models/TimeEntry.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";
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
      assertObjectId(input.projectId);

      const rows = await Task.aggregate<TaskAggregateRow>([
        {
          $match: {
            ownerId,
            projectId: input.projectId,
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
        { $addFields: { sortName: { $toLower: "$name" } } },
        { $sort: { sortName: 1 } },
      ]);

      return rows.map((row) => ({
        ...toClientTask(row),
        totalSec: row.stats[0]?.totalSec ?? 0,
      }));
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

  /** Hard-deletes only when nothing references the task; archives otherwise. */
  remove: protectedProcedure
    .input(idInputSchema)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{
        deleted: boolean;
        archived: boolean;
        message: string | null;
      }> => {
        await findOwnedTask(ctx.user.id, input.id);

        const referenced = await TimeEntry.exists({
          ownerId: ctx.user.id,
          taskId: input.id,
        });

        if (referenced) {
          await Task.updateOne(
            { _id: input.id, ownerId: ctx.user.id },
            { $set: { archived: true } },
          );
          publishSync(
            ctx.user.id,
            { kind: "catalog.changed", scope: "task" },
            input.originId,
          );
          return {
            deleted: false,
            archived: true,
            message:
              "This task has tracked time, so it was archived instead of deleted.",
          };
        }

        await Task.deleteOne({ _id: input.id, ownerId: ctx.user.id });

        publishSync(
          ctx.user.id,
          { kind: "catalog.changed", scope: "task" },
          input.originId,
        );
        return { deleted: true, archived: false, message: null };
      },
    ),
});
