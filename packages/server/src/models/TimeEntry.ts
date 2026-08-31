import mongoose, { Schema, type Document } from "mongoose";
import type { EntrySource, TimeEntry as TimeEntryWire } from "@starter/shared";

export interface ITimeEntry extends Document {
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  start: Date;
  /** `null` means the timer is still running. */
  end: Date | null;
  /** 0 while running. */
  durationSec: number;
  /** Snapshot taken on stop/create so past earnings never shift. */
  hourlyRate: number | null;
  /** Snapshot of the workspace currency. */
  currency: string;
  source: EntrySource;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientTimeEntry} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type TimeEntryDocLike = {
  _id?: unknown;
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  start: Date;
  end: Date | null;
  durationSec: number;
  hourlyRate: number | null;
  currency: string;
  source: EntrySource;
  createdAt: Date;
  updatedAt: Date;
};

const timeEntrySchema = new Schema<ITimeEntry>(
  {
    // No `index: true` here — the compound and partial-unique indexes declared
    // below already cover ownerId, and declaring both makes mongoose warn about
    // a duplicate index on {"ownerId":1}.
    ownerId: { type: String, required: true },
    description: { type: String, required: true, default: "", maxlength: 500 },
    projectId: { type: String, default: null },
    taskId: { type: String, default: null },
    billable: { type: Boolean, required: true, default: false },
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    durationSec: { type: Number, required: true, default: 0, min: 0 },
    hourlyRate: { type: Number, default: null },
    currency: { type: String, required: true, default: "EUR" },
    source: {
      type: String,
      enum: ["web", "desktop", "mobile", "api"],
      required: true,
      default: "web",
    },
  },
  { timestamps: true },
);

/** Range queries: "everything for this owner between two instants". */
timeEntrySchema.index({ ownerId: 1, start: -1 });
timeEntrySchema.index({ ownerId: 1, projectId: 1, start: -1 });

/** At most ONE running entry (`end === null`) per owner. */
timeEntrySchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { end: null } },
);

export const TimeEntry = mongoose.model<ITimeEntry>(
  "TimeEntry",
  timeEntrySchema,
);

/** Convert a TimeEntry document into the exact wire shape. */
export function toClientTimeEntry(doc: TimeEntryDocLike): TimeEntryWire {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    description: doc.description,
    projectId: doc.projectId ?? null,
    taskId: doc.taskId ?? null,
    billable: doc.billable,
    start: doc.start.toISOString(),
    end: doc.end ? doc.end.toISOString() : null,
    durationSec: doc.durationSec,
    hourlyRate: doc.hourlyRate ?? null,
    currency: doc.currency,
    source: doc.source,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
