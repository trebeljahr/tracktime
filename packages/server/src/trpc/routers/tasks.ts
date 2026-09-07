// The tRPC surface over the task services. Logic lives in
// `services/catalog/tasks.ts`, which the public REST API calls directly.
import {
  createTaskSchema,
  idInputSchema,
  taskListSchema,
  updateTaskSchema,
  type Task as TaskWire,
} from "@starter/shared";
import { scopeFromContext } from "../../services/scope.js";
import {
  archiveTask,
  createTask,
  listTasks,
  removeTask,
  updateTask,
  type TaskWithStats,
} from "../../services/catalog/tasks.js";
import { workspaceProcedure, router } from "../trpc.js";
import type { CatalogRemoveResult } from "./catalog-cascade.js";
import { archiveInputSchema } from "./clients.js";

/** Re-exported: the client imports it from here. */
export type { TaskWithStats };

export const tasksRouter = router({
  list: workspaceProcedure
    .input(taskListSchema)
    .query(async ({ ctx, input }): Promise<TaskWithStats[]> =>
      listTasks(scopeFromContext(ctx), input),
    ),

  create: workspaceProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> =>
      createTask(scopeFromContext(ctx), input),
    ),

  update: workspaceProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> =>
      updateTask(scopeFromContext(ctx), input),
    ),

  archive: workspaceProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<TaskWire> =>
      archiveTask(scopeFromContext(ctx), input),
    ),

  /**
   * Always deletes. Entries booked on the task keep their tracked time and
   * their project, and simply fall back to "no task".
   */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> =>
      removeTask(scopeFromContext(ctx), input),
    ),
});
