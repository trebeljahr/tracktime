// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// Clients are the top of the catalog: Client → Project → Task. Every
// procedure is scoped by `workspaceId`, so a document owned by somebody else is
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
  pickCatalogColor,
  updateClientSchema,
  type Client as ClientWire,
} from "@starter/shared";
import { Client, toClientClient } from "../../models/Client.js";
import { publishSync } from "../../ws/sync.js";
import { workspaceProcedure, router } from "../trpc.js";
import {
  cascadeDeleteClient,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";

// The palette, its project offset and the cycling picker live in
// `@starter/shared` so the web picker and the Raycast forms offer exactly the
// colors this router assigns. Re-exported because the sibling catalog routers
// have always imported them from here.
export {
  CATALOG_COLOR_PALETTE,
  PROJECT_COLOR_OFFSET,
  pickCatalogColor,
} from "@starter/shared";


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
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Client.exists({
    workspaceId,
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
  list: workspaceProcedure
    .input(clientListSchema)
    .query(async ({ ctx, input }): Promise<ClientWire[]> => {
      const docs = await Client.find({
        workspaceId: ctx.workspaceId,
        ...(input.includeArchived ? {} : { archived: false }),
      })
        .collation({ locale: "en", strength: 2 })
        .sort({ name: 1 })
        .lean();

      return docs.map(toClientClient);
    }),

  create: workspaceProcedure
    .input(createClientSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      const name = input.name.trim();
      await assertUniqueClientName(ctx.workspaceId, name);

      const existing = await Client.countDocuments({ workspaceId: ctx.workspaceId });
      const created = await Client.create({
        workspaceId: ctx.workspaceId,
        createdBy: ctx.user.id,
        name,
        color: input.color ?? pickCatalogColor(existing),
        archived: false,
      });

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(created);
    }),

  update: workspaceProcedure
    .input(updateClientSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      assertObjectId(input.id);
      if (input.name !== undefined) {
        await assertUniqueClientName(ctx.workspaceId, input.name, input.id);
      }

      const updated = await Client.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
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

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(updated);
    }),

  archive: workspaceProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<ClientWire> => {
      assertObjectId(input.id);

      const updated = await Client.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      }

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return toClientClient(updated);
    }),

  /**
   * Always deletes. Its projects survive as client-less projects, so no
   * tracked time is lost. Use `archive` to keep the client around instead.
   */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      assertObjectId(input.id);

      const client = await Client.findOne({
        _id: input.id,
        workspaceId: ctx.workspaceId,
      }).lean();
      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Client not found",
        });
      }

      const result = await cascadeDeleteClient(ctx.workspaceId, input.id);

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "client" },
        input.originId,
      );
      return result;
    }),
});
