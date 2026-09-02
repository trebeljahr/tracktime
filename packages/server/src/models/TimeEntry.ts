import mongoose, { Schema, type Document } from "mongoose";
import type {
  EntrySource,
  RunawayMark,
  TimeEntry as TimeEntryWire,
} from "@starter/shared";

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
  /** What the runaway guard did about this entry. See @starter/shared/runaway. */
  runaway: RunawayDoc | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The stored form of {@link RunawayMark}: same fields, with the two instants
 * as Dates so Mongo can range-query them if a report ever wants to.
 */
export type RunawayDoc = {
  detectedAt: Date;
  elapsedSec: number;
  limitSec: number;
  action: RunawayMark["action"];
  resolvedAt: Date | null;
};

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
  /** Absent on every entry written before the guard existed. */
  runaway?: RunawayDoc | null;
  createdAt: Date;
  updatedAt: Date;
};

const runawaySchema = new Schema<RunawayDoc>(
  {
    detectedAt: { type: Date, required: true },
    // Together with the entry's `start` these two are what make a cap
    // reversible: `start + elapsedSec` is exactly the span the guard saw, so
    // no truncation is ever unexplainable or unrecoverable.
    elapsedSec: { type: Number, required: true, min: 0 },
    limitSec: { type: Number, required: true, min: 0 },
    action: {
      // Must stay in lockstep with RunawayAction.
      type: String,
      enum: ["flagged", "capped", "stopped"],
      required: true,
    },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false },
);

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
    runaway: { type: runawaySchema, default: null },
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
    runaway: doc.runaway
      ? {
          detectedAt: doc.runaway.detectedAt.toISOString(),
          elapsedSec: doc.runaway.elapsedSec,
          limitSec: doc.runaway.limitSec,
          action: doc.runaway.action,
          resolvedAt: doc.runaway.resolvedAt
            ? doc.runaway.resolvedAt.toISOString()
            : null,
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
