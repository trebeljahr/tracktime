// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// `list` resolves the owning client (even an archived one) and aggregates
// entry counts / tracked seconds in a single pipeline — never N+1.
import { TRPCError } from "@trpc/server";
import {
  createProjectSchema,
  idInputSchema,
  projectListSchema,
  updateProjectSchema,
  type Project as ProjectWire,
} from "@starter/shared";
import { Client } from "../../models/Client.js";
import {
  Project,
  toClientProject,
  type ProjectDocLike,
} from "../../models/Project.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";
import {
  cascadeDeleteProject,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";
import {
  PROJECT_COLOR_OFFSET,
  archiveInputSchema,
  assertObjectId,
  exactNameRegExp,
  pickCatalogColor,
} from "./clients.js";

/** A project plus its joined client and rolled-up time totals. */
export type ProjectWithStats = ProjectWire & {
  clientName: string | null;
  clientColor: string | null;
  /** Number of time entries booked on this project. */
  entryCount: number;
  /** Sum of `durationSec` across those entries (running entries count 0). */
  totalSec: number;
};

/** Raw shape produced by the `list` aggregation. */
type ProjectAggregateRow = ProjectDocLike & {
  clientDoc: { name: string; color: string }[];
  stats: { entryCount: number; totalSec: number }[];
};

async function assertUniqueProjectName(
  ownerId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Project.exists({
    ownerId,
    name: exactNameRegExp(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A project named "${name.trim()}" already exists.`,
    });
  }
}

/** Throws NOT_FOUND when the client is missing or owned by somebody else. */
async function assertClientOwned(
  ownerId: string,
  clientId: string,
): Promise<void> {
  assertObjectId(clientId);
  const exists = await Client.exists({ _id: clientId, ownerId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

export const projectsRouter = router({
  list: protectedProcedure
    .input(projectListSchema)
    .query(async ({ ctx, input }): Promise<ProjectWithStats[]> => {
      const ownerId = ctx.user.id;
      if (typeof input.clientId === "string") assertObjectId(input.clientId);

      const rows = await Project.aggregate<ProjectAggregateRow>([
        {
          $match: {
            ownerId,
            ...(input.includeArchived ? {} : { archived: false }),
            ...(input.clientId !== undefined
              ? { clientId: input.clientId ?? null }
              : {}),
          },
        },
        {
          // Archived clients must still resolve, so this joins by id only.
          $lookup: {
            from: "clients",
            let: { cid: "$clientId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: [{ $toString: "$_id" }, "$$cid"] },
                },
              },
              { $project: { _id: 0, name: 1, color: 1 } },
            ],
            as: "clientDoc",
          },
        },
        {
          $lookup: {
            from: "timeentries",
            let: { pid: { $toString: "$_id" } },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$ownerId", ownerId] },
                      { $eq: ["$projectId", "$$pid"] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  entryCount: { $sum: 1 },
                  totalSec: { $sum: "$durationSec" },
                },
              },
              { $project: { _id: 0, entryCount: 1, totalSec: 1 } },
            ],
            as: "stats",
          },
        },
        { $addFields: { sortName: { $toLower: "$name" } } },
        { $sort: { sortName: 1 } },
      ]);

      return rows.map((row) => {
        const client = row.clientDoc[0];
        const stats = row.stats[0];
        return {
          ...toClientProject(row),
          clientName: client?.name ?? null,
          clientColor: client?.color ?? null,
          entryCount: stats?.entryCount ?? 0,
          totalSec: stats?.totalSec ?? 0,
        };
      });
    }),

  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      const name = input.name.trim();
      await assertUniqueProjectName(ctx.user.id, name);
      if (input.clientId) await assertClientOwned(ctx.user.id, input.clientId);

      const existing = await Project.countDocuments({ ownerId: ctx.user.id });
      const created = await Project.create({
        ownerId: ctx.user.id,
        name,
        color: input.color ?? pickCatalogColor(existing, PROJECT_COLOR_OFFSET),
        clientId: input.clientId ?? null,
        billableDefault: input.billableDefault ?? true,
        hourlyRate: input.hourlyRate ?? null,
        archived: false,
      });

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "project" },
        input.originId,
      );
      return toClientProject(created);
    }),

  update: protectedProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      assertObjectId(input.id);
      if (input.name !== undefined) {
        await assertUniqueProjectName(ctx.user.id, input.name, input.id);
      }
      if (input.clientId) await assertClientOwned(ctx.user.id, input.clientId);

      const updated = await Project.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
        {
          $set: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.clientId !== undefined
              ? { clientId: input.clientId ?? null }
              : {}),
            ...(input.billableDefault !== undefined
              ? { billableDefault: input.billableDefault }
              : {}),
            ...(input.hourlyRate !== undefined
              ? { hourlyRate: input.hourlyRate ?? null }
              : {}),
            ...(input.archived !== undefined
              ? { archived: input.archived }
              : {}),
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "project" },
        input.originId,
      );
      return toClientProject(updated);
    }),

  archive: protectedProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      assertObjectId(input.id);

      const updated = await Project.findOneAndUpdate(
        { _id: input.id, ownerId: ctx.user.id },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      publishSync(
        ctx.user.id,
        { kind: "catalog.changed", scope: "project" },
        input.originId,
      );
      return toClientProject(updated);
    }),

  /**
   * Always deletes. Tasks go with the project; entries booked on either keep
   * their tracked time and become project-less. Use `archive` to keep the
   * project around instead.
   */
  remove: protectedProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      assertObjectId(input.id);

      const project = await Project.findOne({
        _id: input.id,
        ownerId: ctx.user.id,
      }).lean();
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const result = await cascadeDeleteProject(ctx.user.id, input.id);

      publishSync(
        ctx.user.id,
        {
          kind: "catalog.changed",
          scope: "project",
          entriesTouched: result.entriesDetached > 0,
        },
        input.originId,
      );
      return result;
    }),
});
