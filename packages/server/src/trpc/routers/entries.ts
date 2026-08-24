// IMPLEMENTED BY: timer / entries agent
//
// Invariants this file owns:
//  - At most ONE running entry (`end === null`) per ownerId. `start` stops the
//    running one first (the partial unique index in models/TimeEntry.ts is the
//    backstop, not the strategy).
//  - Rate snapshot on stop and on manual create/update: when billable,
//    `hourlyRate = project.hourlyRate ?? settings.defaultHourlyRate`, else null.
//    `currency` is snapshotted from settings.
//  - Every mutation calls `publishSync(ctx.user.id, <event>, input.originId)`.
//  - Every query/mutation is scoped by `ownerId` — another user's document is
//    indistinguishable from a missing one (NOT_FOUND, never FORBIDDEN).
import { TRPCError } from "@trpc/server";
import mongoose, { Types, type PipelineStage } from "mongoose";
import { z } from "zod";
import {
  createEntrySchema,
  entryAmount,
  entryListSchema,
  idInputSchema,
  resolveHourlyRate,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
  type DetailedEntry,
  type EntrySource,
  type TimeEntry as TimeEntryWire,
  type WorkspaceSettings,
} from "@starter/shared";
import { Client, type ClientDocLike } from "../../models/Client.js";
import { Project, type ProjectDocLike } from "../../models/Project.js";
import { Task, type TaskDocLike } from "../../models/Task.js";
import {
  TimeEntry,
  toClientTimeEntry,
  type TimeEntryDocLike,
} from "../../models/TimeEntry.js";
import { getOrCreateSettings } from "../../models/Settings.js";
import { publishSync } from "../../ws/sync.js";
import { protectedProcedure, router } from "../trpc.js";

/** `discard` drops an entry without keeping it; defaults to the running one. */
export const discardTimerSchema = z.object({
  id: z.string().min(1).optional(),
  originId: z.string().max(64).optional(),
});

const DEFAULT_LIST_LIMIT = 50;

const notFound = (message = "Entry not found"): TRPCError =>
  new TRPCError({ code: "NOT_FOUND", message });

const badRequest = (message: string): TRPCError =>
  new TRPCError({ code: "BAD_REQUEST", message });

/**
 * Ids arrive as untrusted strings; an id that cannot possibly address a
 * document must read as "missing", not as a 500 from a Mongo cast error.
 */
const requireObjectId = (id: string, message: string): string => {
  if (!mongoose.isValidObjectId(id)) throw notFound(message);
  return id;
};

const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 11000;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── reference validation ─────────────────────────────────────────────

type ResolvedRefs = {
  projectId: string | null;
  taskId: string | null;
  project: ProjectDocLike | null;
};

const loadProject = async (
  ownerId: string,
  projectId: string,
): Promise<ProjectDocLike> => {
  const project = await Project.findOne({
    _id: requireObjectId(projectId, "Project not found"),
    ownerId,
  }).lean();
  if (!project) throw notFound("Project not found");
  return project;
};

/**
 * Validate that the referenced project/task belong to the caller and agree
 * with each other. A task given without a project adopts the task's project.
 */
const resolveRefs = async (
  ownerId: string,
  projectId: string | null,
  taskId: string | null,
): Promise<ResolvedRefs> => {
  let effectiveProjectId = projectId;
  let project = effectiveProjectId
    ? await loadProject(ownerId, effectiveProjectId)
    : null;

  if (!taskId) {
    return { projectId: effectiveProjectId, taskId: null, project };
  }

  const task = await Task.findOne({
    _id: requireObjectId(taskId, "Task not found"),
    ownerId,
  }).lean();
  if (!task) throw notFound("Task not found");

  if (effectiveProjectId && task.projectId !== effectiveProjectId) {
    throw badRequest("Task does not belong to the given project");
  }

  if (!effectiveProjectId) {
    effectiveProjectId = task.projectId;
    project = await loadProject(ownerId, effectiveProjectId);
  }

  return { projectId: effectiveProjectId, taskId, project };
};

// ── rate snapshots ───────────────────────────────────────────────────

type RateSnapshot = { hourlyRate: number | null; currency: string };

const snapshotRate = (
  billable: boolean,
  project: ProjectDocLike | null,
  settings: WorkspaceSettings,
): RateSnapshot => ({
  hourlyRate: resolveHourlyRate({
    billable,
    projectRate: project?.hourlyRate ?? null,
    defaultRate: settings.defaultHourlyRate,
  }),
  currency: settings.currency,
});

// ── running-timer helpers ────────────────────────────────────────────

const durationBetween = (start: Date, end: Date): number =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));

/**
 * Write the stop of one running entry: end, duration and the rate snapshot.
 * Returns `null` when the entry was already stopped by a concurrent request.
 */
const finalizeStop = async (
  ownerId: string,
  entryId: string,
  start: Date,
  projectId: string | null,
  billable: boolean,
  end: Date,
): Promise<TimeEntryWire | null> => {
  const settings = await getOrCreateSettings(ownerId);
  const project = projectId
    ? await Project.findOne({ _id: projectId, ownerId }).lean()
    : null;
  const { hourlyRate, currency } = snapshotRate(billable, project, settings);

  const stopped = await TimeEntry.findOneAndUpdate(
    { _id: entryId, ownerId, end: null },
    {
      $set: {
        end,
        durationSec: durationBetween(start, end),
        hourlyRate,
        currency,
      },
    },
    { new: true },
  ).lean();

  return stopped ? toClientTimeEntry(stopped) : null;
};

/** Stop whatever is running for this owner, at `at` (never before its start). */
const stopRunningEntry = async (
  ownerId: string,
  at: Date,
  originId?: string,
): Promise<void> => {
  const running = await TimeEntry.findOne({ ownerId, end: null }).lean();
  if (!running) return;

  const endMs = Math.max(at.getTime(), running.start.getTime());
  const stopped = await finalizeStop(
    ownerId,
    String(running._id),
    running.start,
    running.projectId,
    running.billable,
    new Date(endMs),
  );
  if (stopped) {
    publishSync(ownerId, { kind: "timer.stopped", entry: stopped }, originId);
  }
};

type StartArgs = {
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  /** `undefined` falls back to the project's `billableDefault`. */
  billable: boolean | undefined;
  start: Date;
  source: EntrySource;
  originId?: string;
};

/**
 * Stop the running entry, then open a new one. Shared by `start` and
 * `continue` so both go through exactly one code path.
 */
const startNewEntry = async (args: StartArgs): Promise<TimeEntryWire> => {
  const refs = await resolveRefs(args.ownerId, args.projectId, args.taskId);
  const billable =
    args.billable ?? refs.project?.billableDefault ?? false;
  const settings = await getOrCreateSettings(args.ownerId);
  const { hourlyRate, currency } = snapshotRate(
    billable,
    refs.project,
    settings,
  );

  const insert = async (): Promise<TimeEntryWire> => {
    const created = await TimeEntry.create({
      ownerId: args.ownerId,
      description: args.description,
      projectId: refs.projectId,
      taskId: refs.taskId,
      billable,
      start: args.start,
      end: null,
      durationSec: 0,
      hourlyRate,
      currency,
      source: args.source,
    });
    return toClientTimeEntry(created);
  };

  await stopRunningEntry(args.ownerId, args.start, args.originId);

  try {
    return await insert();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // A concurrent start slipped in between our stop and our insert.
    await stopRunningEntry(args.ownerId, args.start, args.originId);
    try {
      return await insert();
    } catch (retryError) {
      if (!isDuplicateKeyError(retryError)) throw retryError;
      throw new TRPCError({
        code: "CONFLICT",
        message: "Another timer is already running",
      });
    }
  }
};

// ── list aggregation ─────────────────────────────────────────────────

type EntryAggregate = TimeEntryDocLike & {
  _id: unknown;
  project?: ProjectDocLike | null;
  client?: ClientDocLike | null;
  task?: TaskDocLike | null;
};

const toDetailedEntry = (doc: EntryAggregate): DetailedEntry => {
  const entry = toClientTimeEntry(doc);
  return {
    ...entry,
    projectName: doc.project?.name ?? null,
    projectColor: doc.project?.color ?? null,
    clientName: doc.client?.name ?? null,
    taskName: doc.task?.name ?? null,
    amount: entryAmount(entry.durationSec, entry.hourlyRate),
  };
};

const encodeCursor = (entry: DetailedEntry): string =>
  `${entry.start}|${entry.id}`;

type DecodedCursor = { start: Date; id: Types.ObjectId };

const decodeCursor = async (
  ownerId: string,
  cursor: string,
): Promise<DecodedCursor | null> => {
  const separator = cursor.lastIndexOf("|");
  const rawId = separator === -1 ? cursor : cursor.slice(separator + 1);
  if (!mongoose.isValidObjectId(rawId)) return null;
  const id = new Types.ObjectId(rawId);

  if (separator !== -1) {
    const startMs = Date.parse(cursor.slice(0, separator));
    if (Number.isFinite(startMs)) return { start: new Date(startMs), id };
  }

  const doc = await TimeEntry.findOne({ _id: id, ownerId })
    .select("start")
    .lean();
  return doc ? { start: doc.start, id } : null;
};

export const entriesRouter = router({
  list: protectedProcedure.input(entryListSchema).query(
    async ({
      ctx,
      input,
    }): Promise<{ entries: DetailedEntry[]; nextCursor?: string }> => {
      const ownerId = ctx.user.id;
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw badRequest("Invalid from/to range");
      }

      const conditions: Record<string, unknown>[] = [
        { ownerId },
        // Overlap: the entry starts before the window ends and either is
        // still running or ended after the window began.
        { start: { $lt: to } },
        { $or: [{ end: null }, { end: { $gt: from } }] },
      ];

      let projectIds: string[] | null = input.projectIds ?? null;
      if (input.clientIds && input.clientIds.length > 0) {
        const clientProjects = await Project.find({
          ownerId,
          clientId: { $in: input.clientIds },
        })
          .select("_id")
          .lean();
        const viaClients = clientProjects.map((project) =>
          String(project._id),
        );
        projectIds = projectIds
          ? projectIds.filter((id) => viaClients.includes(id))
          : viaClients;
      }
      if (projectIds) conditions.push({ projectId: { $in: projectIds } });

      if (input.taskIds) conditions.push({ taskId: { $in: input.taskIds } });
      if (typeof input.billable === "boolean") {
        conditions.push({ billable: input.billable });
      }
      if (input.search && input.search.trim() !== "") {
        conditions.push({
          description: new RegExp(escapeRegExp(input.search.trim()), "i"),
        });
      }

      if (input.cursor) {
        const cursor = await decodeCursor(ownerId, input.cursor);
        if (!cursor) return { entries: [] };
        conditions.push({
          $or: [
            { start: { $lt: cursor.start } },
            { start: cursor.start, _id: { $lt: cursor.id } },
          ],
        });
      }

      const limit = input.limit ?? DEFAULT_LIST_LIMIT;

      const pipeline: PipelineStage[] = [
        { $match: { $and: conditions } },
        { $sort: { start: -1, _id: -1 } },
        { $limit: limit + 1 },
        {
          $addFields: {
            projectOid: {
              $convert: {
                input: "$projectId",
                to: "objectId",
                onError: null,
                onNull: null,
              },
            },
            taskOid: {
              $convert: {
                input: "$taskId",
                to: "objectId",
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $lookup: {
            from: Project.collection.name,
            localField: "projectOid",
            foreignField: "_id",
            as: "projectDocs",
          },
        },
        {
          $lookup: {
            from: Task.collection.name,
            localField: "taskOid",
            foreignField: "_id",
            as: "taskDocs",
          },
        },
        {
          $addFields: {
            project: { $arrayElemAt: ["$projectDocs", 0] },
            task: { $arrayElemAt: ["$taskDocs", 0] },
          },
        },
        {
          $addFields: {
            clientOid: {
              $convert: {
                input: "$project.clientId",
                to: "objectId",
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $lookup: {
            from: Client.collection.name,
            localField: "clientOid",
            foreignField: "_id",
            as: "clientDocs",
          },
        },
        { $addFields: { client: { $arrayElemAt: ["$clientDocs", 0] } } },
        {
          $project: {
            projectDocs: 0,
            taskDocs: 0,
            clientDocs: 0,
            projectOid: 0,
            taskOid: 0,
            clientOid: 0,
          },
        },
      ];

      const rows = await TimeEntry.aggregate<EntryAggregate>(pipeline);
      const page = rows.slice(0, limit).map(toDetailedEntry);
      const last = page[page.length - 1];

      return rows.length > limit && last
        ? { entries: page, nextCursor: encodeCursor(last) }
        : { entries: page };
    },
  ),

  get: protectedProcedure
    .input(idInputSchema)
    .query(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const entry = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        ownerId: ctx.user.id,
      }).lean();
      if (!entry) throw notFound();
      return toClientTimeEntry(entry);
    }),

  /** The running entry (`end === null`), or null when the timer is stopped. */
  current: protectedProcedure.query(
    async ({ ctx }): Promise<TimeEntryWire | null> => {
      const running = await TimeEntry.findOne({
        ownerId: ctx.user.id,
        end: null,
      }).lean();
      return running ? toClientTimeEntry(running) : null;
    },
  ),

  start: protectedProcedure
    .input(startTimerSchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const start = input.start ? new Date(input.start) : new Date();
      if (Number.isNaN(start.getTime())) throw badRequest("Invalid start");

      const entry = await startNewEntry({
        ownerId: ctx.user.id,
        description: input.description ?? "",
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        billable: input.billable,
        start,
        source: input.source ?? "web",
        originId: input.originId,
      });

      publishSync(
        ctx.user.id,
        { kind: "timer.started", entry },
        input.originId,
      );
      return entry;
    }),

  stop: protectedProcedure
    .input(stopTimerSchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const ownerId = ctx.user.id;
      const running = input.id
        ? await TimeEntry.findOne({
            _id: requireObjectId(input.id, "Entry not found"),
            ownerId,
          }).lean()
        : await TimeEntry.findOne({ ownerId, end: null }).lean();

      if (!running) throw notFound("No running timer");
      if (running.end !== null) throw badRequest("Entry is not running");

      const end = input.end ? new Date(input.end) : new Date();
      if (Number.isNaN(end.getTime())) throw badRequest("Invalid end");
      if (end.getTime() <= running.start.getTime()) {
        throw badRequest("End must be after start");
      }

      const stopped = await finalizeStop(
        ownerId,
        String(running._id),
        running.start,
        running.projectId,
        running.billable,
        end,
      );
      if (!stopped) throw badRequest("Entry is not running");

      publishSync(
        ownerId,
        { kind: "timer.stopped", entry: stopped },
        input.originId,
      );
      return stopped;
    }),

  /** Delete the running entry instead of keeping it. */
  discard: protectedProcedure
    .input(discardTimerSchema)
    .mutation(
      async ({ ctx, input }): Promise<{ success: true; id: string }> => {
        const ownerId = ctx.user.id;
        const running = input.id
          ? await TimeEntry.findOne({
              _id: requireObjectId(input.id, "Entry not found"),
              ownerId,
              end: null,
            }).lean()
          : await TimeEntry.findOne({ ownerId, end: null }).lean();

        if (!running) throw notFound("No running timer");

        const id = String(running._id);
        await TimeEntry.deleteOne({ _id: id, ownerId });
        publishSync(ownerId, { kind: "entry.deleted", id }, input.originId);
        return { success: true, id };
      },
    ),

  /** Start a new timer with the same description/project/task/billable. */
  continue: protectedProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const ownerId = ctx.user.id;
      const source = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        ownerId,
      }).lean();
      if (!source) throw notFound();

      const entry = await startNewEntry({
        ownerId,
        description: source.description,
        projectId: source.projectId,
        taskId: source.taskId,
        billable: source.billable,
        start: new Date(),
        source: source.source,
        originId: input.originId,
      });

      publishSync(ownerId, { kind: "timer.started", entry }, input.originId);
      return entry;
    }),

  /** Manual entry with an explicit start and end. */
  create: protectedProcedure
    .input(createEntrySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const ownerId = ctx.user.id;
      const start = new Date(input.start);
      const end = new Date(input.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw badRequest("Invalid start/end");
      }
      if (end.getTime() <= start.getTime()) {
        throw badRequest("End must be after start");
      }

      const refs = await resolveRefs(
        ownerId,
        input.projectId ?? null,
        input.taskId ?? null,
      );
      const billable =
        input.billable ?? refs.project?.billableDefault ?? false;
      const settings = await getOrCreateSettings(ownerId);
      const { hourlyRate, currency } = snapshotRate(
        billable,
        refs.project,
        settings,
      );

      const created = await TimeEntry.create({
        ownerId,
        description: input.description,
        projectId: refs.projectId,
        taskId: refs.taskId,
        billable,
        start,
        end,
        durationSec: durationBetween(start, end),
        hourlyRate,
        currency,
        source: input.source ?? "web",
      });

      const entry = toClientTimeEntry(created);
      publishSync(ownerId, { kind: "entry.upserted", entry }, input.originId);
      return entry;
    }),

  update: protectedProcedure
    .input(updateEntrySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const ownerId = ctx.user.id;
      const existing = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        ownerId,
      }).lean();
      if (!existing) throw notFound();

      const projectChanged = input.projectId !== undefined;
      const taskChanged = input.taskId !== undefined;
      const billableChanged =
        input.billable !== undefined && input.billable !== existing.billable;

      const refs =
        projectChanged || taskChanged
          ? await resolveRefs(
              ownerId,
              projectChanged ? input.projectId ?? null : existing.projectId,
              taskChanged ? input.taskId ?? null : existing.taskId,
            )
          : {
              projectId: existing.projectId,
              taskId: existing.taskId,
              project: existing.projectId
                ? await Project.findOne({
                    _id: existing.projectId,
                    ownerId,
                  }).lean()
                : null,
            };

      const start = input.start ? new Date(input.start) : existing.start;
      if (Number.isNaN(start.getTime())) throw badRequest("Invalid start");

      const end =
        input.end === undefined
          ? existing.end
          : input.end === null
            ? null
            : new Date(input.end);
      if (end && Number.isNaN(end.getTime())) throw badRequest("Invalid end");
      if (end && end.getTime() <= start.getTime()) {
        throw badRequest("End must be after start");
      }

      const billable = input.billable ?? existing.billable;
      const durationSec = end ? durationBetween(start, end) : 0;

      // Re-snapshot when the money inputs change, or when this edit is what
      // stops a running entry. Otherwise the historical snapshot stands.
      const stoppedByThisEdit = existing.end === null && end !== null;
      const resnapshot =
        billableChanged ||
        refs.projectId !== existing.projectId ||
        stoppedByThisEdit;

      let hourlyRate = existing.hourlyRate;
      let currency = existing.currency;
      if (resnapshot) {
        const settings = await getOrCreateSettings(ownerId);
        const snapshot = snapshotRate(billable, refs.project, settings);
        hourlyRate = snapshot.hourlyRate;
        currency = snapshot.currency;
      } else if (!billable) {
        hourlyRate = null;
      }

      let updated;
      try {
        updated = await TimeEntry.findOneAndUpdate(
          { _id: String(existing._id), ownerId },
          {
            $set: {
              description: input.description ?? existing.description,
              projectId: refs.projectId,
              taskId: refs.taskId,
              billable,
              start,
              end,
              durationSec,
              hourlyRate,
              currency,
            },
          },
          { new: true },
        ).lean();
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another timer is already running",
          });
        }
        throw error;
      }
      if (!updated) throw notFound();

      const entry = toClientTimeEntry(updated);
      publishSync(ownerId, { kind: "entry.upserted", entry }, input.originId);
      return entry;
    }),

  remove: protectedProcedure
    .input(idInputSchema)
    .mutation(
      async ({ ctx, input }): Promise<{ success: true; id: string }> => {
        const ownerId = ctx.user.id;
        const result = await TimeEntry.deleteOne({
          _id: requireObjectId(input.id, "Entry not found"),
          ownerId,
        });
        if (result.deletedCount === 0) throw notFound();

        publishSync(
          ownerId,
          { kind: "entry.deleted", id: input.id },
          input.originId,
        );
        return { success: true, id: input.id };
      },
    ),
});
