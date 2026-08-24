// IMPLEMENTED BY: tokens / settings agent
//
// Personal API tokens for the Raycast / Chrome extensions.
//  - The plaintext token crosses the wire exactly once, from `create`.
//    `list` and `revoke` project it (and its hash) out of every read.
//  - Tokens are never hard-deleted; `revoke` stamps `revokedAt` so the audit
//    trail survives.
import { TRPCError } from "@trpc/server";
import mongoose from "mongoose";
import {
  createTokenSchema,
  idInputSchema,
  type ApiToken as ApiTokenWire,
  type CreatedApiToken,
} from "@starter/shared";
import { ApiToken, toClientApiToken } from "../../models/ApiToken.js";
import { generateApiToken } from "../../auth/api-token.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";

/** Hard cap on live tokens per user — revoked tokens do not count. */
const MAX_ACTIVE_TOKENS = 20;

/** Fields safe to read back. `tokenHash` is never selected, anywhere. */
const SAFE_FIELDS = "ownerId name prefix lastUsedAt revokedAt createdAt";

export const tokensRouter = router({
  /** Metadata only — the plaintext token and its hash never appear here. */
  list: protectedProcedure.query(async ({ ctx }): Promise<ApiTokenWire[]> => {
    const docs = await ApiToken.find({ ownerId: ctx.user.id })
      .select(SAFE_FIELDS)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map(toClientApiToken);
  }),

  /** Returns the plaintext token exactly once — it is never readable again. */
  create: protectedProcedure
    .input(createTokenSchema)
    .mutation(async ({ ctx, input }): Promise<CreatedApiToken> => {
      const active = await ApiToken.countDocuments({
        ownerId: ctx.user.id,
        revokedAt: null,
      });
      if (active >= MAX_ACTIVE_TOKENS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `You can have at most ${MAX_ACTIVE_TOKENS} active API tokens. Revoke one first.`,
        });
      }

      const { token, prefix, tokenHash } = generateApiToken();
      const doc = await ApiToken.create({
        ownerId: ctx.user.id,
        name: input.name.trim(),
        prefix,
        tokenHash,
        lastUsedAt: null,
        revokedAt: null,
      });

      publishSync(ctx.user.id, { kind: "settings.changed" }, input.originId);
      return { ...toClientApiToken(doc), token };
    }),

  /** Idempotent. Sets `revokedAt`; the document itself is kept forever. */
  revoke: protectedProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<ApiTokenWire> => {
      if (!mongoose.Types.ObjectId.isValid(input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
      }

      // Scoped by ownerId: another user's token is indistinguishable from a
      // missing one.
      const existing = await ApiToken.findOne({
        _id: input.id,
        ownerId: ctx.user.id,
      })
        .select(SAFE_FIELDS)
        .lean()
        .exec();
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
      }
      if (existing.revokedAt) return toClientApiToken(existing);

      const revoked = await ApiToken.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { new: true, projection: SAFE_FIELDS },
      )
        .lean()
        .exec();
      if (!revoked) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
      }

      publishSync(ctx.user.id, { kind: "settings.changed" }, input.originId);
      return toClientApiToken(revoked);
    }),
});
