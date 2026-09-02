import mongoose, { Schema, type Document } from "mongoose";
import type { Task as TaskWire } from "@starter/shared";

export interface ITask extends Document {
  workspaceId: string;
  createdBy: string;
  projectId: string;
  name: string;
  done: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientTask} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type TaskDocLike = {
  _id?: unknown;
  workspaceId: string;
  createdBy: string;
  projectId: string;
  name: string;
  done: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const taskSchema = new Schema<ITask>(
  {
    workspaceId: { type: String, required: true, index: true },
    // NOT `required` — mongoose's String required validator rejects ""
    // because it tests for a non-empty string, so pairing required:true
    // with default:"" makes any write that omits `createdBy` (a migration,
    // a seed, a backfill) fail with "Path `createdBy` is required".
    // Same trap as TimeEntry.description.
    createdBy: { type: String, default: "" },
    projectId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
    done: { type: Boolean, required: true, default: false },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

taskSchema.index({ workspaceId: 1, projectId: 1 });

export const Task = mongoose.model<ITask>("Task", taskSchema);

/** Convert a Task document into the exact wire shape. */
export function toClientTask(doc: TaskDocLike): TaskWire {
  return {
    id: String(doc._id),
    workspaceId: doc.workspaceId,
    createdBy: doc.createdBy,
    projectId: doc.projectId,
    name: doc.name,
    done: doc.done,
    archived: doc.archived,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
