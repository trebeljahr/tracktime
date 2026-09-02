// IMPLEMENTED BY: catalog agent (clients / projects / tasks)
//
// `list` resolves the owning client (even an archived one) and aggregates
// entry counts / tracked seconds in a single pipeline — never N+1.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProjectSchema,
  idInputSchema,
  projectListSchema,
  updateProjectSchema,
  type BudgetProgress,
  type Project as ProjectWire,
} from "@starter/shared";
import { Client } from "../../models/Client.js";
import {
  Project,
  toClientProject,
  type ProjectDocLike,
} from "../../models/Project.js";
import { getOrCreateWorkspaceSettings } from "../../models/Settings.js";
import { publishSync } from "../../ws/sync.js";
import { workspaceProcedure, router } from "../trpc.js";
import {
  cascadeDeleteProject,
  type CatalogRemoveResult,
} from "./catalog-cascade.js";
import {
  budgetWrite,
  loadBudgetProgress,
  needsCurrency,
  touchesBudget,
} from "./project-budgets.js";
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
  /**
   * Lifetime progress against the project's estimate/budget, or null when it
   * has neither. Null is the "no target set" signal — a project with a target
   * of zero still gets a progress object.
   */
  progress: BudgetProgress | null;
};

/** Raw shape produced by the `list` aggregation. */
type ProjectAggregateRow = ProjectDocLike & {
  clientDoc: { name: string; color: string }[];
  stats: { entryCount: number; totalSec: number }[];
};

async function assertUniqueProjectName(
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clash = await Project.exists({
    workspaceId,
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
  workspaceId: string,
  clientId: string,
): Promise<void> {
  assertObjectId(clientId);
  const exists = await Client.exists({ _id: clientId, workspaceId });
  if (!exists) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
}

export const projectsRouter = router({
  list: workspaceProcedure
    .input(projectListSchema)
    .query(async ({ ctx, input }): Promise<ProjectWithStats[]> => {
      const workspaceId = ctx.workspaceId;
      if (typeof input.clientId === "string") assertObjectId(input.clientId);

      const rows = await Project.aggregate<ProjectAggregateRow>([
        {
          $match: {
            workspaceId,
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
                      { $eq: ["$workspaceId", workspaceId] },
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

      const projects = rows.map((row) => {
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

      // Costs nothing until a project actually carries a target, and archived
      // projects keep reporting: their history is still the answer to
      // "did that job come in under budget?".
      const progress = await loadBudgetProgress(workspaceId, projects);

      return projects.map((project) => ({
        ...project,
        progress: progress.get(project.id) ?? null,
      }));
    }),

  create: workspaceProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      const name = input.name.trim();
      await assertUniqueProjectName(ctx.workspaceId, name);
      if (input.clientId) await assertClientOwned(ctx.workspaceId, input.clientId);

      const existing = await Project.countDocuments({
        workspaceId: ctx.workspaceId,
      });
      // Only read settings when a money budget is actually being set — every
      // other create stays a single write.
      const workspaceCurrency = needsCurrency(input)
        ? (await getOrCreateWorkspaceSettings(ctx.workspaceId)).currency
        : "";
      const created = await Project.create({
        workspaceId: ctx.workspaceId,
        createdBy: ctx.user.id,
        name,
        color: input.color ?? pickCatalogColor(existing, PROJECT_COLOR_OFFSET),
        clientId: input.clientId ?? null,
        billableDefault: input.billableDefault ?? true,
        hourlyRate: input.hourlyRate ?? null,
        estimatedHours: null,
        budgetAmount: null,
        budgetCurrency: null,
        ...budgetWrite(input, workspaceCurrency),
        idleBehavior: input.idleBehavior ?? null,
        archived: false,
      });

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "project" },
        input.originId,
      );
      return toClientProject(created);
    }),

  update: workspaceProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      assertObjectId(input.id);
      if (input.name !== undefined) {
        await assertUniqueProjectName(ctx.workspaceId, input.name, input.id);
      }
      if (input.clientId) await assertClientOwned(ctx.workspaceId, input.clientId);

      // Changing a budget's amount must keep the currency it was agreed in,
      // so the existing snapshot is read before it is overwritten. An
      // estimate-only edit needs neither lookup.
      let budgetSet: Record<string, unknown> = {};
      if (touchesBudget(input)) {
        if (needsCurrency(input)) {
          const [settings, existing] = await Promise.all([
            getOrCreateWorkspaceSettings(ctx.workspaceId),
            Project.findOne({ _id: input.id, workspaceId: ctx.workspaceId })
              .select("budgetAmount budgetCurrency")
              .lean(),
          ]);
          budgetSet = budgetWrite(input, settings.currency, {
            budgetAmount: existing?.budgetAmount ?? null,
            budgetCurrency: existing?.budgetCurrency ?? null,
          });
        } else {
          budgetSet = budgetWrite(input, "");
        }
      }

      const updated = await Project.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
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
            ...(input.idleBehavior !== undefined
              ? { idleBehavior: input.idleBehavior ?? null }
              : {}),
            ...(input.archived !== undefined
              ? { archived: input.archived }
              : {}),
            ...budgetSet,
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      void publishSync(
        ctx.workspaceId,
        { kind: "catalog.changed", scope: "project" },
        input.originId,
      );
      return toClientProject(updated);
    }),

  archive: workspaceProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> => {
      assertObjectId(input.id);

      const updated = await Project.findOneAndUpdate(
        { _id: input.id, workspaceId: ctx.workspaceId },
        { $set: { archived: input.archived ?? true } },
        { returnDocument: "after" },
      ).lean();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      void publishSync(
        ctx.workspaceId,
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
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> => {
      assertObjectId(input.id);

      const project = await Project.findOne({
        _id: input.id,
        workspaceId: ctx.workspaceId,
      }).lean();
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const result = await cascadeDeleteProject(ctx.workspaceId, input.id);

      void publishSync(
        ctx.workspaceId,
        {
          kind: "catalog.changed",
          scope: "project",
          entriesTouched: result.entriesDetached > 0,
        },
        input.originId,
      );
      // A detached pin still points somewhere it did not a moment ago, and
      // `catalog.changed` does not cover the favorites cache.
      if (result.favoritesDetached > 0) {
        void publishSync(
          ctx.workspaceId,
          { kind: "favorites.changed" },
          input.originId,
        );
      }
      return result;
    }),
});
