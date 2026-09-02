import mongoose, { Schema, type Document } from "mongoose";
import type { EntrySource, TimeEntry as TimeEntryWire } from "@starter/shared";

export interface ITimeEntry extends Document {
  workspaceId: string;
  authorId: string;
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
  timeZone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientTimeEntry} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type TimeEntryDocLike = {
  _id?: unknown;
  workspaceId: string;
  authorId: string;
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
  timeZone: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const timeEntrySchema = new Schema<ITimeEntry>(
  {
    // No `index: true` on either scope field — the compound and partial-unique
    // indexes declared below already cover them, and declaring both makes
    // mongoose warn about a duplicate index.
    workspaceId: { type: String, required: true },
    authorId: { type: String, required: true },
    // NOT `required` — an entry with no description is completely normal
    // ("just start the timer, name it later"), and mongoose's String required
    // validator rejects "" because it tests for a non-empty string. Pairing
    // required:true with default:"" made every such start fail with
    // "Path `description` is required".
    description: { type: String, default: "", maxlength: 500 },
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
      // Must stay in lockstep with EntrySource — Mongoose rejects the write
      // silently-looking (a ValidationError deep in a mutation) if it drifts.
      enum: ["web", "desktop", "mobile", "extension", "api"],
      required: true,
      default: "web",
    },
    // See the note on TimeEntry.timeZone in @starter/shared.
    timeZone: { type: String, default: null },
  },
  { timestamps: true },
);

/** Range queries: "everything in this workspace between two instants". */
timeEntrySchema.index({ workspaceId: 1, start: -1 });
timeEntrySchema.index({ workspaceId: 1, projectId: 1, start: -1 });
/** Per-member reads: the `memberIds` report filter, and the visibility clause
 * that restricts a member without `canViewOthersTime` to their own rows. */
timeEntrySchema.index({ workspaceId: 1, authorId: 1, start: -1 });

/**
 * At most ONE running entry (`end === null`) per PERSON, across every
 * workspace they belong to.
 *
 * Deliberately keyed on `authorId` alone and NOT compounded with
 * `workspaceId`: a human has one body and cannot be working in two workspaces
 * at once. The compound form would permit one running timer per workspace,
 * which makes `entries.current` list-shaped and leaves the extension badge and
 * the Raycast menu bar with no way to answer "what am I doing right now".
 *
 * Consequence, by design: starting a timer in one workspace stops the one
 * running in another. Callers must surface that rather than let it happen
 * silently.
 */
timeEntrySchema.index(
  { authorId: 1 },
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
    workspaceId: doc.workspaceId,
    authorId: doc.authorId,
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
    timeZone: doc.timeZone ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
