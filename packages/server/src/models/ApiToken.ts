import mongoose, { Schema, type Document } from "mongoose";
import type { ApiToken as ApiTokenWire } from "@starter/shared";

export interface IApiToken extends Document {
  ownerId: string;
  name: string;
  /** Short, non-secret identifier shown in listings. */
  prefix: string;
  /** Hash of the plaintext token — the plaintext itself is never stored. */
  tokenHash: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientApiToken} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type ApiTokenDocLike = {
  _id?: unknown;
  ownerId: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

const apiTokenSchema = new Schema<IApiToken>(
  {
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 120, trim: true },
    prefix: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ApiToken = mongoose.model<IApiToken>("ApiToken", apiTokenSchema);

/**
 * Convert an ApiToken document into the exact wire shape. The plaintext token
 * is never part of this — it is returned only once, by `tokens.create`.
 */
export function toClientApiToken(doc: ApiTokenDocLike): ApiTokenWire {
  return {
    id: String(doc._id),
    ownerId: doc.ownerId,
    name: doc.name,
    prefix: doc.prefix,
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
  };
}
