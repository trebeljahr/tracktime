import mongoose, { Schema, type Document } from "mongoose";
import type {
  ImportBatchSummary,
  ImportDateOrder,
  ImportFormat,
  ImportShape,
} from "@starter/shared";

/**
 * The receipt for one bulk import, and the only thing that makes an import
 * reversible.
 *
 * The entries themselves are found by `TimeEntry.importId`, not by a list of
 * ids kept here: a year of history is tens of thousands of rows, and a
 * document that grew with the import would eventually hit Mongo's 16MB
 * ceiling on exactly the imports that most need undoing. The catalog documents
 * an import created ARE listed here, because there are a handful of them and
 * because "delete the projects this file invented" has no other query.
 */
export interface IImportBatch extends Document {
  workspaceId: string;
  createdBy: string;
  filename: string | null;
  format: ImportFormat;
  shape: ImportShape;
  dateOrder: ImportDateOrder;
  timeZone: string;
  entriesCreated: number;
  entriesSkipped: number;
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
  tagIds: string[];
  totalSec: number;
  firstStart: Date | null;
  lastStart: Date | null;
  /** Set once the batch has been rolled back. Batches are never deleted. */
  undoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ImportBatchDocLike = {
  _id?: unknown;
  filename: string | null;
  entriesCreated: number;
  entriesSkipped: number;
  clientIds: string[];
  projectIds: string[];
  taskIds: string[];
  tagIds: string[];
  totalSec: number;
  firstStart: Date | null;
  lastStart: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
};

const importBatchSchema = new Schema<IImportBatch>(
  {
    workspaceId: { type: String, required: true },
    // NOT `required`, for the reason written on every other createdBy in this
    // codebase: mongoose's String validator rejects "", so a required field
    // with an empty default fails any write that omits it.
    createdBy: { type: String, default: "" },
    filename: { type: String, default: null, maxlength: 255 },
    format: { type: String, required: true, default: "delimited" },
    shape: { type: String, required: true, default: "start-end" },
    dateOrder: { type: String, required: true, default: "ymd" },
    timeZone: { type: String, required: true, default: "UTC" },
    entriesCreated: { type: Number, required: true, default: 0, min: 0 },
    entriesSkipped: { type: Number, required: true, default: 0, min: 0 },
    clientIds: { type: [String], default: [] },
    projectIds: { type: [String], default: [] },
    taskIds: { type: [String], default: [] },
    tagIds: { type: [String], default: [] },
    totalSec: { type: Number, required: true, default: 0, min: 0 },
    firstStart: { type: Date, default: null },
    lastStart: { type: Date, default: null },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The history table: newest first, per workspace. */
importBatchSchema.index({ workspaceId: 1, createdAt: -1 });

export const ImportBatch = mongoose.model<IImportBatch>(
  "ImportBatch",
  importBatchSchema,
);

/** Convert an ImportBatch document into the exact wire shape. */
export function toClientImportBatch(
  doc: ImportBatchDocLike,
): ImportBatchSummary {
  return {
    batchId: String(doc._id),
    filename: doc.filename ?? null,
    entriesCreated: doc.entriesCreated,
    entriesSkipped: doc.entriesSkipped,
    clientsCreated: doc.clientIds.length,
    projectsCreated: doc.projectIds.length,
    tasksCreated: doc.taskIds.length,
    tagsCreated: doc.tagIds.length,
    totalSec: doc.totalSec,
    firstStart: doc.firstStart ? doc.firstStart.toISOString() : null,
    lastStart: doc.lastStart ? doc.lastStart.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    undoneAt: doc.undoneAt ? doc.undoneAt.toISOString() : null,
  };
}
