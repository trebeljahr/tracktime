import mongoose, { Schema, type Document } from "mongoose";
import type { Client as ClientWire } from "@starter/shared";

export const DEFAULT_CLIENT_COLOR = "#64748b";

export interface IClient extends Document {
  workspaceId: string;
  createdBy: string;
  name: string;
  color: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientClient} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type ClientDocLike = {
  _id?: unknown;
  workspaceId: string;
  createdBy: string;
  name: string;
  color: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const clientSchema = new Schema<IClient>(
  {
    workspaceId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true, default: "" },
    name: { type: String, required: true, maxlength: 120, trim: true },
    color: { type: String, required: true, default: DEFAULT_CLIENT_COLOR },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

clientSchema.index({ workspaceId: 1, archived: 1 });

export const Client = mongoose.model<IClient>("Client", clientSchema);

/** Convert a Client document into the exact wire shape. */
export function toClientClient(doc: ClientDocLike): ClientWire {
  return {
    id: String(doc._id),
    workspaceId: doc.workspaceId,
    createdBy: doc.createdBy,
    name: doc.name,
    color: doc.color,
    archived: doc.archived,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
