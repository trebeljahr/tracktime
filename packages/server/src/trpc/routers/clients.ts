// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// Clients are the top of the catalog: Client → Project → Task. Every
// procedure is scoped by `ownerId`, so a document owned by somebody else is
// indistinguishable from a missing one (NOT_FOUND, never FORBIDDEN).
//
// This file also owns the small helpers the sibling catalog routers reuse:
// the shared color palette, the case-insensitive duplicate-name matcher and
// the ObjectId guard.
import { TRPCError } from "@trpc/server";
import mongoose from "mongoose";
import { z } from "zod";
import {
  clientListSchema,
  createClientSchema,
  idInputSchema,
  updateClientSchema,
  type Client as ClientWire,
} from "@starter/shared";
import { Client, toClientClient } from "../../models/Client.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";
import {
  cascadeDeleteClient,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";

/**
 * Fixed palette assigned to new clients / projects that ship no explicit
 * color. Twelve hues that stay legible on both light and dark surfaces.
 */
export const CATALOG_COLOR_PALETTE: readonly string[] = [
  "#4f46e5", // indigo
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#22c55e", // green
  "#84cc16", // lime
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#ec4899", // pink
  "#a855f7", // purple
  "#8b5cf6", // violet
  "#64748b", // slate
];

/** Offset applied to project colors so they cycle out of phase with clients. */
export const PROJECT_COLOR_OFFSET = 6;

/**
 * Pick the next palette entry, cycling forever. `offset` lets projects start
 * at a different point in the cycle than clients so the two lists look
 * visually distinct even when created in lockstep.
 */
export function pickCatalogColor(index: number, offset = 0): string {
  const size = CATALOG_COLOR_PALETTE.length;
  const slot = ((index + offset) % size + size) % size;
  return CATALOG_COLOR_PALETTE[slot] ?? CATALOG_COLOR_PALETTE[0] ?? "#4f46e5";
}

/** Escape a user-supplied string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Anchored, case-insensitive matcher used for duplicate-name checks. */
export function exactNameRegExp(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name.trim())}$`, "i");
}

/**
 * Ids cross the wire as opaque strings, so a malformed one must not blow up
 * as a Mongoose CastError — it is simply not found.
 */
export function assertObjectId(id: string): string {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  }
  return id;
}

/** `archive` toggles: `archived` defaults to true when the caller omits it. */
export const archiveInputSchema = idInputSchema.extend({
  archived: z.boolean().optional(),
});

async function assertUniqueClientName(
  ownerId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Client.exists({
    ownerId,
    name: exactNameRegExp(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A client named "${name.trim()}" already exists.`,
    });
  }
}

export const clientsRouter = router({
  list: protectedProcedure
    .input(clientListSchema)
    .query(async ({ ctx, input }): Promise<ClientWire[]> => {
      const docs = await Client.find({
        ownerId: ctx.user.id,
        ...(input.includeArchived ? {} : { archived: false }),
      })
        .collation({ locale: "en", strength: 2 })
        .sort({ name: 1 })
        .lean();

      return docs.map(toClientClient);
    }),

  create: protectedProcedure
    .input(createClientSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      const name = input.name.trim();
      await assertUniqueClientName(ctx.user.id, name);

      const existing = await Client.countDocuments({ ownerId: ctx.user.id });
      const created = await Client.create({
        ownerId: ctx.user.id,
        name,
        color: input.color ?? pickCatalogColor(existing),
        archived: false,
      });

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(created);
    }),

  update: protectedProcedure
    .input(updateClientSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      assertObjectId(input.id);
      if (input.name !== undefined) {
        await assertUniqueClientName(ctx.user.id, input.name, input.id);
      }

      const updated = await Client.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
        {
          $set: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.archived !== undefined
              ? { archived: input.archived }
              : {}),
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(updated);
    }),

  archive: protectedProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      assertObjectId(input.id);

      const updated = await Client.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(updated);
    }),

  /**
   * Always deletes. Its projects survive as client-less projects, so no
   * tracked time is lost. Use `archive` to keep the client around instead.
   */
  remove: protectedProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      assertObjectId(input.id);

      const client = await Client.findOne({
        _id: input.id,
        ownerId: ctx.user.id,
      }).lean();
      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Client not found",
        });
      }

      const result = await cascadeDeleteClient(ctx.user.id, input.id);

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return result;
    }),
});
