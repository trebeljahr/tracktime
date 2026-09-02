import mongoose, { Schema, type Document } from "mongoose";
import type { Favorite as FavoriteWire } from "@starter/shared";

export interface IFavorite extends Document {
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  /** Position in the pinned row. Dense from 0, rewritten by `reorder`. */
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientFavorite} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type FavoriteDocLike = {
  _id?: unknown;
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

const favoriteSchema = new Schema<IFavorite>(
  {
    // No `index: true` here — the compound index below already covers
    // ownerId, and declaring both makes mongoose warn about a duplicate.
    ownerId: { type: String, required: true },
    // NOT `required`: a favorite that is only "the Acme project, billable" is
    // a perfectly good pin, and mongoose's String required validator rejects
    // "" because it tests for a non-empty string.
    description: { type: String, default: "", maxlength: 500 },
    projectId: { type: String, default: null },
    taskId: { type: String, default: null },
    billable: { type: Boolean, required: true, default: false },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

/** The only read there is: "this owner's pins, in their order". */
favoriteSchema.index({ ownerId: 1, order: 1 });

export const Favorite = mongoose.model<IFavorite>("Favorite", favoriteSchema);

/** Convert a Favorite document into the exact wire shape. */
export function toClientFavorite(doc: FavoriteDocLike): FavoriteWire {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    description: doc.description,
    projectId: doc.projectId ?? null,
    taskId: doc.taskId ?? null,
    billable: doc.billable,
    order: doc.order,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
