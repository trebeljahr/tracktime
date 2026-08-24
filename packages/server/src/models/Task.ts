import mongoose, { Schema, type Document } from "mongoose";
import type { Task as TaskWire } from "@starter/shared";

export interface ITask extends Document {
  ownerId: string;
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
  ownerId: string;
  projectId: string;
  name: string;
  done: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const taskSchema = new Schema<ITask>(
  {
    ownerId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
    done: { type: Boolean, required: true, default: false },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

taskSchema.index({ ownerId: 1, projectId: 1 });

export const Task = mongoose.model<ITask>("Task", taskSchema);

/** Convert a Task document into the exact wire shape. */
export function toClientTask(doc: TaskDocLike): TaskWire {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    projectId: doc.projectId,
    name: doc.name,
    done: doc.done,
    archived: doc.archived,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
