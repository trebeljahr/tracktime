// IMPLEMENTED BY: timer / entries agent
//
// Invariants this file owns:
//  - At most ONE running entry (`end === null`) per PERSON, across every
//    workspace they belong to. `start` stops the running one first (the partial
//    unique index on `authorId` in models/TimeEntry.ts is the backstop, not the
//    strategy). The running entry may live in a DIFFERENT workspace than the
//    request — every running-timer helper below is therefore author-scoped and
//    deliberately carries no workspace filter.
//  - Rate snapshot on stop and on manual create/update: when billable,
//    `hourlyRate = project.hourlyRate ?? settings.defaultHourlyRate`, else null.
//    `currency` is snapshotted from the WORKSPACE's settings, never the
//    caller's — two members stopping a timer in one workspace must agree.
//  - Every mutation publishes into the workspace the affected entry belongs to.
//  - Every query/mutation is scoped by `ctx.workspaceId` — a document in
//    another workspace is indistinguishable from a missing one (NOT_FOUND,
//    never FORBIDDEN).
import { TRPCError } from "@trpc/server";
import mongoose, { Types, type PipelineStage } from "mongoose";
import { z } from "zod";
import {
  createEntrySchema,
  entryAmount,
  entryListSchema,
  continueEntrySchema,
  idInputSchema,
  recentEntriesSchema,
  resolveHourlyRate,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
  type DetailedEntry,
  type EntrySource,
  type RecentEntry,
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
import { getOrCreateWorkspaceSettings } from "../../models/Settings.js";
import { authorScopeFilter } from "../../models/WorkspaceMember.js";
import { publishSync } from "../../ws/sync.js";
import { router, workspaceProcedure } from "../trpc.js";
import { loadCatalogLookup } from "./catalog-lookup.js";
import { collapseRecents, type RecentSourceEntry } from "./quick-start.js";

/** `discard` drops an entry without keeping it; defaults to the running one. */
export const discardTimerSchema = z.object({
  id: z.string().min(1).optional(),
  originId: z.string().max(64).optional(),
});

const DEFAULT_LIST_LIMIT = 50;

/** How many distinct combinations `recent` answers with by default. */
const DEFAULT_RECENT_LIMIT = 8;

/** How far back `recent` looks by default. */
const DEFAULT_RECENT_DAYS = 30;

/**
 * How many entries `recent` reads before collapsing them.
 *
 * The dedup happens in this process rather than in a `$group` stage, because
 * the rules worth getting right — which of several identical jobs supplies the
 * timestamp, how an archived project is labelled, whether the running entry
 * counts — are the rules worth unit-testing, and a pipeline stage cannot be
 * tested without a database. The cap is what keeps that honest: a window this
 * size is a page, not a table scan, and `limit` distinct rows almost always
 * appear well inside it.
 */
const RECENT_SCAN_LIMIT = 400;

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
  workspaceId: string,
  projectId: string,
): Promise<ProjectDocLike> => {
  const project = await Project.findOne({
    _id: requireObjectId(projectId, "Project not found"),
    workspaceId,
  }).lean();
  if (!project) throw notFound("Project not found");
  return project;
};

/**
 * Validate that the referenced project/task belong to the caller and agree
 * with each other. A task given without a project adopts the task's project.
 */
const resolveRefs = async (
  workspaceId: string,
  projectId: string | null,
  taskId: string | null,
): Promise<ResolvedRefs> => {
  let effectiveProjectId = projectId;
  let project = effectiveProjectId
    ? await loadProject(workspaceId, effectiveProjectId)
    : null;

  if (!taskId) {
    return { projectId: effectiveProjectId, taskId: null, project };
  }

  const task = await Task.findOne({
    _id: requireObjectId(taskId, "Task not found"),
    workspaceId,
  }).lean();
  if (!task) throw notFound("Task not found");

  if (effectiveProjectId && task.projectId !== effectiveProjectId) {
    throw badRequest("Task does not belong to the given project");
  }

  if (!effectiveProjectId) {
    effectiveProjectId = task.projectId;
    project = await loadProject(workspaceId, effectiveProjectId);
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
 *
 * Takes the entry itself rather than a scope id, because the entry being
 * stopped is not necessarily in the workspace the request is addressed to —
 * see `stopRunningEntry`. Its rate snapshot must come from ITS workspace.
 */
const finalizeStop = async (
  running: TimeEntryDocLike,
  end: Date,
): Promise<TimeEntryWire | null> => {
  const settings = await getOrCreateWorkspaceSettings(running.workspaceId);
  const project = running.projectId
    ? await Project.findOne({
        _id: running.projectId,
        workspaceId: running.workspaceId,
      }).lean()
    : null;
  const { hourlyRate, currency } = snapshotRate(
    running.billable,
    project,
    settings,
  );

  const stopped = await TimeEntry.findOneAndUpdate(
    { _id: String(running._id), authorId: running.authorId, end: null },
    {
      $set: {
        end,
        durationSec: durationBetween(running.start, end),
        hourlyRate,
        currency,
      },
    },
    { returnDocument: "after" },
  ).lean();

  return stopped ? toClientTimeEntry(stopped) : null;
};

/**
 * Stop whatever this PERSON has running, at `at` (never before its start).
 *
 * Deliberately not workspace-scoped: the invariant is one running timer per
 * human across every workspace, so starting a timer in one workspace stops the
 * one running in another. The stop event is published into the stopped entry's
 * own workspace, which may not be the one the request came in for — otherwise
 * the colleagues watching that other workspace would never see it stop.
 */
const stopRunningEntry = async (
  authorId: string,
  at: Date,
  originId?: string,
): Promise<void> => {
  const running = await TimeEntry.findOne({ authorId, end: null }).lean();
  if (!running) return;

  const endMs = Math.max(at.getTime(), running.start.getTime());
  const stopped = await finalizeStop(running, new Date(endMs));
  if (stopped) {
    void publishSync(
      running.workspaceId,
      { kind: "timer.stopped", entry: stopped },
      originId,
    );
  }
};

type StartArgs = {
  workspaceId: string;
  authorId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  /** `undefined` falls back to the project's `billableDefault`. */
  billable: boolean | undefined;
  start: Date;
  source: EntrySource;
  /** IANA zone the caller is in. See TimeEntry.timeZone in @starter/shared. */
  timeZone?: string | null;
  originId?: string;
};

/**
 * Stop the running entry, then open a new one. Shared by `start` and
 * `continue` so both go through exactly one code path.
 */
const startNewEntry = async (args: StartArgs): Promise<TimeEntryWire> => {
  const refs = await resolveRefs(args.workspaceId, args.projectId, args.taskId);
  const billable =
    args.billable ?? refs.project?.billableDefault ?? false;
  const settings = await getOrCreateWorkspaceSettings(args.workspaceId);
  const { hourlyRate, currency } = snapshotRate(
    billable,
    refs.project,
    settings,
  );

  const insert = async (): Promise<TimeEntryWire> => {
    const created = await TimeEntry.create({
      workspaceId: args.workspaceId,
      authorId: args.authorId,
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
      timeZone: args.timeZone ?? null,
    });
    return toClientTimeEntry(created);
  };

  await stopRunningEntry(args.authorId, args.start, args.originId);

  try {
    return await insert();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // A concurrent start slipped in between our stop and our insert.
    await stopRunningEntry(args.authorId, args.start, args.originId);
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
  workspaceId: string,
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

  const doc = await TimeEntry.findOne({ _id: id, workspaceId })
    .select("start")
    .lean();
  return doc ? { start: doc.start, id } : null;
};

export const entriesRouter = router({
  list: workspaceProcedure.input(entryListSchema).query(
    async ({
      ctx,
      input,
    }): Promise<{ entries: DetailedEntry[]; nextCursor?: string }> => {
      const workspaceId = ctx.workspaceId;
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw badRequest("Invalid from/to range");
      }

      const conditions: Record<string, unknown>[] = [
        { workspaceId },
        // Overlap: the entry starts before the window ends and either is
        // still running or ended after the window began.
        { start: { $lt: to } },
        { $or: [{ end: null }, { end: { $gt: from } }] },
      ];

      // A member without `canViewOthersTime` sees only their own rows. Applied
      // here rather than in the UI, and to the same `$match` the aggregation
      // runs on, so there is no shape of this query that forgets it.
      const authorScope = authorScopeFilter(ctx.visibility);
      if (authorScope) conditions.push(authorScope);

      let projectIds: string[] | null = input.projectIds ?? null;
      if (input.clientIds && input.clientIds.length > 0) {
        const clientProjects = await Project.find({
          workspaceId,
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
        const cursor = await decodeCursor(workspaceId, input.cursor);
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

  /**
   * The distinct things this person has recently tracked, newest first.
   *
   * Tier one of the quick-start surfaces: derived, so it costs no new model
   * and is never stale. Pinning something is what promotes it to a favorite,
   * which is tier two.
   */
  recent: workspaceProcedure
    .input(recentEntriesSchema)
    .query(async ({ ctx, input }): Promise<RecentEntry[]> => {
      const workspaceId = ctx.workspaceId;
      const limit = input.limit ?? DEFAULT_RECENT_LIMIT;
      const days = input.days ?? DEFAULT_RECENT_DAYS;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await TimeEntry.find({
        workspaceId,
        // "What have *I* recently tracked" — a quick-start list is about the
        // caller's own habits, so it is author-scoped regardless of whether
        // they may see colleagues' entries.
        authorId: ctx.user.id,
        start: { $gte: since },
        // Finished entries only. The running one is excluded again inside
        // `collapseRecents`; matching on it here would only waste a slot in
        // the scan window.
        end: { $ne: null },
      })
        .sort({ start: -1, _id: -1 })
        .limit(RECENT_SCAN_LIMIT)
        .select({
          description: 1,
          projectId: 1,
          taskId: 1,
          billable: 1,
          start: 1,
          end: 1,
        })
        .lean();

      const entries: RecentSourceEntry[] = rows.map((row) => ({
        id: String(row._id),
        description: row.description,
        projectId: row.projectId ?? null,
        taskId: row.taskId ?? null,
        billable: row.billable,
        start: row.start.toISOString(),
        end: row.end === null ? null : row.end.toISOString(),
      }));

      const catalog = await loadCatalogLookup(workspaceId, entries);
      return collapseRecents(entries, catalog, limit);
    }),

  get: workspaceProcedure
    .input(idInputSchema)
    .query(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const entry = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        workspaceId: ctx.workspaceId,
        ...(authorScopeFilter(ctx.visibility) ?? {}),
      }).lean();
      if (!entry) throw notFound();
      return toClientTimeEntry(entry);
    }),

  /**
   * The running entry (`end === null`), or null when the timer is stopped.
   *
   * Deliberately NOT workspace-scoped. The invariant is one running timer per
   * person across every workspace, so this must answer "what am I doing right
   * now" wherever that timer lives — which is exactly what the extension badge
   * and the Raycast menu bar render. The entry carries its own `workspaceId`
   * so a caller can say "running in Acme".
   */
  current: workspaceProcedure.query(
    async ({ ctx }): Promise<TimeEntryWire | null> => {
      const running = await TimeEntry.findOne({
        authorId: ctx.user.id,
        end: null,
      }).lean();
      return running ? toClientTimeEntry(running) : null;
    },
  ),

  start: workspaceProcedure
    .input(startTimerSchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const start = input.start ? new Date(input.start) : new Date();
      if (Number.isNaN(start.getTime())) throw badRequest("Invalid start");

      const entry = await startNewEntry({
        workspaceId: ctx.workspaceId,
        authorId: ctx.user.id,
        description: input.description ?? "",
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        billable: input.billable,
        start,
        source: input.source ?? "web",
        timeZone: input.timeZone ?? null,
        originId: input.originId,
      });

      void publishSync(
        ctx.workspaceId,
        { kind: "timer.started", entry },
        input.originId,
      );
      return entry;
    }),

  stop: workspaceProcedure
    .input(stopTimerSchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      // Author-scoped, not workspace-scoped: you may always stop your own
      // timer, including from a client currently pointed at a different
      // workspace. Stopping somebody else's is not a thing that exists.
      const authorId = ctx.user.id;
      const running = input.id
        ? await TimeEntry.findOne({
            _id: requireObjectId(input.id, "Entry not found"),
            authorId,
          }).lean()
        : await TimeEntry.findOne({ authorId, end: null }).lean();

      if (!running) throw notFound("No running timer");
      if (running.end !== null) throw badRequest("Entry is not running");

      const end = input.end ? new Date(input.end) : new Date();
      if (Number.isNaN(end.getTime())) throw badRequest("Invalid end");
      if (end.getTime() <= running.start.getTime()) {
        throw badRequest("End must be after start");
      }

      const stopped = await finalizeStop(running, end);
      if (!stopped) throw badRequest("Entry is not running");

      void publishSync(
        running.workspaceId,
        { kind: "timer.stopped", entry: stopped },
        input.originId,
      );
      return stopped;
    }),

  /** Delete the running entry instead of keeping it. */
  discard: workspaceProcedure
    .input(discardTimerSchema)
    .mutation(
      async ({ ctx, input }): Promise<{ success: true; id: string }> => {
        // Author-scoped for the same reason as `stop`.
        const authorId = ctx.user.id;
        const running = input.id
          ? await TimeEntry.findOne({
              _id: requireObjectId(input.id, "Entry not found"),
              authorId,
              end: null,
            }).lean()
          : await TimeEntry.findOne({ authorId, end: null }).lean();

        if (!running) throw notFound("No running timer");

        const id = String(running._id);
        await TimeEntry.deleteOne({ _id: id, authorId });
        void publishSync(
          running.workspaceId,
          { kind: "entry.deleted", id },
          input.originId,
        );
        return { success: true, id };
      },
    ),

  /** Start a new timer with the same description/project/task/billable. */
  continue: workspaceProcedure
    .input(continueEntrySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const workspaceId = ctx.workspaceId;
      const source = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        workspaceId,
        ...(authorScopeFilter(ctx.visibility) ?? {}),
      }).lean();
      if (!source) throw notFound();

      const entry = await startNewEntry({
        workspaceId,
        authorId: ctx.user.id,
        description: source.description,
        projectId: source.projectId,
        taskId: source.taskId,
        billable: source.billable,
        start: new Date(),
        source: source.source,
        // A continued entry is being recorded NOW, wherever the person now is,
        // so it takes the caller's zone rather than inheriting the original's.
        timeZone: input.timeZone ?? null,
        originId: input.originId,
      });

      void publishSync(
        workspaceId,
        { kind: "timer.started", entry },
        input.originId,
      );
      return entry;
    }),

  /** Manual entry with an explicit start and end. */
  create: workspaceProcedure
    .input(createEntrySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const workspaceId = ctx.workspaceId;
      const start = new Date(input.start);
      const end = new Date(input.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw badRequest("Invalid start/end");
      }
      if (end.getTime() <= start.getTime()) {
        throw badRequest("End must be after start");
      }

      const refs = await resolveRefs(
        workspaceId,
        input.projectId ?? null,
        input.taskId ?? null,
      );
      const billable =
        input.billable ?? refs.project?.billableDefault ?? false;
      const settings = await getOrCreateWorkspaceSettings(workspaceId);
      const { hourlyRate, currency } = snapshotRate(
        billable,
        refs.project,
        settings,
      );

      const created = await TimeEntry.create({
        workspaceId,
        authorId: ctx.user.id,
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
        timeZone: input.timeZone ?? null,
      });

      const entry = toClientTimeEntry(created);
      void publishSync(
        workspaceId,
        { kind: "entry.upserted", entry },
        input.originId,
      );
      return entry;
    }),

  update: workspaceProcedure
    .input(updateEntrySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const workspaceId = ctx.workspaceId;
      // Editing is author-only, independent of viewing: `canViewOthersTime`
      // grants sight of a colleague's entries, never the right to rewrite
      // them. Somebody else's entry reads as missing.
      const existing = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        workspaceId,
        authorId: ctx.user.id,
      }).lean();
      if (!existing) throw notFound();

      const projectChanged = input.projectId !== undefined;
      const taskChanged = input.taskId !== undefined;
      const billableChanged =
        input.billable !== undefined && input.billable !== existing.billable;

      const refs =
        projectChanged || taskChanged
          ? await resolveRefs(
              workspaceId,
              projectChanged ? input.projectId ?? null : existing.projectId,
              taskChanged ? input.taskId ?? null : existing.taskId,
            )
          : {
              projectId: existing.projectId,
              taskId: existing.taskId,
              project: existing.projectId
                ? await Project.findOne({
                    _id: existing.projectId,
                    workspaceId,
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
        const settings = await getOrCreateWorkspaceSettings(workspaceId);
        const snapshot = snapshotRate(billable, refs.project, settings);
        hourlyRate = snapshot.hourlyRate;
        currency = snapshot.currency;
      } else if (!billable) {
        hourlyRate = null;
      }

      let updated;
      try {
        updated = await TimeEntry.findOneAndUpdate(
          { _id: String(existing._id), workspaceId, authorId: ctx.user.id },
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
          { returnDocument: "after" },
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
      void publishSync(
        workspaceId,
        { kind: "entry.upserted", entry },
        input.originId,
      );
      return entry;
    }),

  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(
      async ({ ctx, input }): Promise<{ success: true; id: string }> => {
        // Author-only, for the same reason as `update`.
        const result = await TimeEntry.deleteOne({
          _id: requireObjectId(input.id, "Entry not found"),
          workspaceId: ctx.workspaceId,
          authorId: ctx.user.id,
        });
        if (result.deletedCount === 0) throw notFound();

        void publishSync(
          ctx.workspaceId,
          { kind: "entry.deleted", id: input.id },
          input.originId,
        );
        return { success: true, id: input.id };
      },
    ),
});
