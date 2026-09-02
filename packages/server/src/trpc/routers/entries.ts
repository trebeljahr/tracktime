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
  resolveRunawaySchema,
  resolvedEndMs,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
  type DetailedEntry,
  type EntrySource,
  type RecentEntry,
  type RunawayMark,
  type TimeEntry as TimeEntryWire,
} from "@starter/shared";
import { Client, type ClientDocLike } from "../../models/Client.js";
import { Project, type ProjectDocLike } from "../../models/Project.js";
import { Tag } from "../../models/Tag.js";
import { Task, type TaskDocLike } from "../../models/Task.js";
import {
  TimeEntry,
  toClientTimeEntry,
  type TimeEntryDocLike,
} from "../../models/TimeEntry.js";
import { getOrCreateWorkspaceSettings } from "../../models/Settings.js";
import { authorScopeFilter } from "../../models/WorkspaceMember.js";
import {
  durationBetween,
  finalizeStop,
  snapshotRate,
} from "../../services/entry-stop.js";
import { enforceMaxEntryDuration } from "../../services/runaway.js";
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
 * The parts of an entry an invoice's line items are computed from.
 *
 * `description` and `tagIds` are deliberately absent: neither reaches a line
 * item, so relabelling or re-tagging billed time is harmless and stays allowed.
 * Everything listed here does reach one — changing it behind an issued invoice
 * would leave that invoice claiming hours, a rate or a project the underlying
 * time no longer has, with nothing on screen to say the two had diverged.
 */
const INVOICE_RELEVANT_FIELDS = [
  "projectId",
  "taskId",
  "billable",
  "start",
  "end",
] as const;

/**
 * Why an edit to an already-invoiced entry must be refused, or `null` when it
 * is fine to proceed.
 *
 * `Invoice.entryIds` and `TimeEntry.invoiceId` keep the same time from being
 * billed twice, but nothing stopped the billed time itself from moving after
 * the fact. An invoice is a record of what was billed, so the entry is frozen
 * in the ways the invoice depends on rather than the invoice being silently
 * recomputed underneath the customer who already received it.
 *
 * Exported for the unit tests — the rule is worth pinning independently of a
 * database.
 */
export function invoicedEntryEditRefusal(
  invoiceId: string | null | undefined,
  changedFields: readonly string[],
): string | null {
  if (!invoiceId) return null;

  const blocked = INVOICE_RELEVANT_FIELDS.filter((field) =>
    changedFields.includes(field),
  );
  if (blocked.length === 0) return null;

  return (
    `This time has already been invoiced, so its ${blocked.join(", ")} ` +
    "cannot be changed — the invoice's line items were calculated from it. " +
    "Delete the invoice while it is still a draft to release its time, then " +
    "edit and bill it again. Its description and tags can still be changed."
  );
}

const invoiceConflict = (message: string): TRPCError =>
  new TRPCError({ code: "CONFLICT", message });

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

// ── tags ─────────────────────────────────────────────────────────────

/**
 * Hard cap on tags per entry, kept in lockstep with `entryTagIds` in
 * @starter/shared. The schema already rejects an over-long array, so this is
 * the second line of defence for the paths that build a list themselves
 * (`continue` copies the source entry's tags).
 */
export const MAX_ENTRY_TAGS = 20;

/**
 * Clean a caller-supplied tag list WITHOUT touching the database.
 *
 * Deduplicates (first occurrence wins, so the order the user picked survives),
 * drops nothing silently otherwise, and rejects anything that could not
 * possibly address a Tag — a malformed id must read as a bad request, never
 * as a Mongo cast error deep inside the write.
 *
 * `undefined` in means `undefined` out: "leave the entry's tags alone" is a
 * different instruction from "set the entry's tags to none", and only an
 * explicit `[]` means the latter.
 */
export const normalizeTagIds = (
  tagIds: readonly string[] | undefined,
): string[] | undefined => {
  if (tagIds === undefined) return undefined;

  const unique = [...new Set(tagIds)];
  if (unique.length > MAX_ENTRY_TAGS) {
    throw badRequest(`An entry can carry at most ${MAX_ENTRY_TAGS} tags`);
  }
  if (unique.some((id) => !mongoose.isValidObjectId(id))) {
    throw badRequest("Unknown tag");
  }
  return unique;
};

/**
 * Normalize, then prove every id belongs to the caller.
 *
 * One `countDocuments` scoped by `workspaceId` answers both "does it exist?"
 * and "is it in this workspace?" — a mismatch is a BAD_REQUEST rather than a
 * NOT_FOUND because the caller told us about a tag we cannot honour, and
 * answering "not found" would leak that another workspace's tag has that id.
 */
const resolveTagIds = async (
  workspaceId: string,
  tagIds: readonly string[] | undefined,
): Promise<string[] | undefined> => {
  const unique = normalizeTagIds(tagIds);
  if (unique === undefined || unique.length === 0) return unique;

  const found = await Tag.countDocuments({
    workspaceId,
    _id: { $in: unique },
  });
  if (found !== unique.length) {
    throw badRequest("One or more tags do not exist");
  }
  return unique;
};

/**
 * The lenient counterpart, for ids the SERVER copied rather than the caller
 * supplying them (`continue`). A tag that vanished between the original entry
 * and now must not make continuing that work fail — the right answer is to
 * carry forward the labels that still exist and drop the ones that do not.
 */
const filterKnownTagIds = async (
  workspaceId: string,
  tagIds: readonly string[] | undefined,
): Promise<string[]> => {
  const unique = normalizeTagIds(tagIds) ?? [];
  if (unique.length === 0) return [];

  const known = await Tag.find({ workspaceId, _id: { $in: unique } })
    .select("_id")
    .lean();
  const knownIds = new Set(known.map((tag) => String(tag._id)));
  return unique.filter((id) => knownIds.has(id));
};

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

// ── running-timer helpers ────────────────────────────────────────────

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
  /** Tags to open the entry with; `undefined` means none. */
  tagIds?: readonly string[];
  originId?: string;
};

/**
 * Stop the running entry, then open a new one. Shared by `start` and
 * `continue` so both go through exactly one code path.
 */
const startNewEntry = async (args: StartArgs): Promise<TimeEntryWire> => {
  const refs = await resolveRefs(args.workspaceId, args.projectId, args.taskId);
  const tagIds = (await resolveTagIds(args.workspaceId, args.tagIds)) ?? [];
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
      tagIds,
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

      // OR within itself, AND with everything else: an entry matches when it
      // carries ANY of the requested tags. An EMPTY array is deliberately not
      // a filter at all — it means "no tag filter", never "untagged only",
      // because that is what an untouched multi-select sends.
      if (input.tagIds && input.tagIds.length > 0) {
        conditions.push({ tagIds: { $in: input.tagIds } });
      }

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
      // Where the runaway guard is evaluated. There is no scheduler in this
      // server and deliberately so — the read that would have shown a stale
      // 63-hour timer is the read that deals with it. Author-scoped like the
      // query below it, and for the same reason. See services/runaway.ts.
      const outcome = await enforceMaxEntryDuration(ctx.user.id);
      // The guard already holds the authoritative document; re-reading it
      // would only re-race the write that just landed.
      if (outcome.kind === "ended") return null;
      if (outcome.kind === "flagged") return outcome.entry;

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

      // Before `startNewEntry` closes whatever is running at `now` and hides
      // the evidence. A runaway that is merely superseded by the next start
      // keeps all 63 hours and is never mentioned again; run it through the
      // guard first so it is capped, or at least marked, either way.
      await enforceMaxEntryDuration(ctx.user.id, start);

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
        ...(input.tagIds ? { tagIds: input.tagIds } : {}),
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

  /**
   * Answer the runaway prompt.
   *
   * The one thing this mutation exists to guarantee is that a cap is never
   * final: `restore` puts back exactly the span the guard measured, because
   * the mark kept `elapsedSec` alongside the entry's own `start`. Nothing the
   * guard does is ever a one-way door.
   *
   * `cap` and `restore` recompute their instant here from the mark rather than
   * trusting one off the wire; only `end-at` takes a client-supplied time, and
   * it is validated like any other manual edit.
   *
   * Author-scoped, like `stop` and `discard`: the entry may be in a workspace
   * the caller is not currently pointed at, and answering a question about
   * your own timer must work from wherever you happen to be. The event goes
   * into the entry's own workspace.
   */
  resolveRunaway: workspaceProcedure
    .input(resolveRunawaySchema)
    .mutation(async ({ ctx, input }): Promise<TimeEntryWire> => {
      const authorId = ctx.user.id;
      const existing = await TimeEntry.findOne({
        _id: requireObjectId(input.id, "Entry not found"),
        authorId,
      }).lean();
      if (!existing) throw notFound();
      if (!existing.runaway) {
        throw badRequest("Entry has no runaway timer to resolve");
      }

      const mark: RunawayMark = {
        detectedAt: existing.runaway.detectedAt.toISOString(),
        elapsedSec: existing.runaway.elapsedSec,
        limitSec: existing.runaway.limitSec,
        action: existing.runaway.action,
        resolvedAt: null,
      };

      const suppliedEndMs =
        input.end === undefined ? null : Date.parse(input.end);
      if (suppliedEndMs !== null && Number.isNaN(suppliedEndMs)) {
        throw badRequest("Invalid end");
      }
      if (input.resolution === "end-at" && suppliedEndMs === null) {
        throw badRequest("An end is required to set the real end time");
      }

      const startMs = existing.start.getTime();
      const endMs = resolvedEndMs(
        input.resolution,
        startMs,
        mark,
        suppliedEndMs,
      );
      const resolvedAt = new Date();

      // "keep" — dismiss and change nothing. It means the same thing whether
      // the entry is still running (keep running, this really is a long
      // session) or already capped (the cap was right).
      if (endMs === null) {
        const kept = await TimeEntry.findOneAndUpdate(
          { _id: String(existing._id), authorId },
          { $set: { "runaway.resolvedAt": resolvedAt } },
          { returnDocument: "after" },
        ).lean();
        if (!kept) throw notFound();

        const entry = toClientTimeEntry(kept);
        void publishSync(
          existing.workspaceId,
          { kind: "entry.upserted", entry },
          input.originId,
        );
        return entry;
      }

      if (endMs <= startMs) throw badRequest("End must be after start");

      // A running entry goes through the same stop path as any other stop, so
      // the rate snapshot is taken exactly once and in exactly one place — and
      // from the entry's workspace, not the caller's. An already-ended entry
      // keeps the snapshot it was stopped with: only the boundary moves, and
      // the money inputs did not change.
      if (existing.end === null) {
        const stopped = await finalizeStop(existing, new Date(endMs));
        if (!stopped) throw badRequest("Entry is not running");

        const resolved = await TimeEntry.findOneAndUpdate(
          { _id: String(existing._id), authorId },
          { $set: { "runaway.resolvedAt": resolvedAt } },
          { returnDocument: "after" },
        ).lean();
        const entry = resolved ? toClientTimeEntry(resolved) : stopped;

        void publishSync(
          existing.workspaceId,
          { kind: "timer.stopped", entry },
          input.originId,
        );
        return entry;
      }

      const updated = await TimeEntry.findOneAndUpdate(
        { _id: String(existing._id), authorId },
        {
          $set: {
            end: new Date(endMs),
            durationSec: durationBetween(existing.start, new Date(endMs)),
            "runaway.resolvedAt": resolvedAt,
          },
        },
        { returnDocument: "after" },
      ).lean();
      if (!updated) throw notFound();

      const entry = toClientTimeEntry(updated);
      void publishSync(
        existing.workspaceId,
        { kind: "entry.upserted", entry },
        input.originId,
      );
      return entry;
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
        // Tags go the OTHER way: continuing is "more of this same work", so
        // the labels that described it still describe it. A tag deleted since
        // then is dropped rather than copied forward dead — see
        // `filterKnownTagIds` for why this path is lenient.
        tagIds: await filterKnownTagIds(ctx.workspaceId, source.tagIds),
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
      const tagIds = (await resolveTagIds(workspaceId, input.tagIds)) ?? [];
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
        tagIds,
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

      // Refuse before doing any work: an entry on an issued invoice is frozen
      // in the ways that invoice was calculated from.
      const refusal = invoicedEntryEditRefusal(
        existing.invoiceId,
        INVOICE_RELEVANT_FIELDS.filter((field) => input[field] !== undefined),
      );
      if (refusal) throw invoiceConflict(refusal);

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

      // `tagIds` REPLACES the whole set when present. Omitting the key leaves
      // the entry's tags exactly as they were, so a partial edit (rename the
      // description, nudge the end time) can never silently untag an entry.
      const tagIds = await resolveTagIds(ctx.workspaceId, input.tagIds);

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
              ...(tagIds !== undefined ? { tagIds } : {}),
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
        const entryId = requireObjectId(input.id, "Entry not found");

        // Deleting billed time is the worst version of the divergence the
        // update guard prevents: the invoice would go on claiming hours whose
        // entry no longer exists, so it cannot be reconciled at all.
        // Author-only, for the same reason as `update`.
        const existing = await TimeEntry.findOne({
          _id: entryId,
          workspaceId: ctx.workspaceId,
          authorId: ctx.user.id,
        })
          .select("invoiceId")
          .lean();
        if (!existing) throw notFound();
        if (existing.invoiceId) {
          throw invoiceConflict(
            "This time has already been invoiced and cannot be deleted. " +
              "Delete the invoice while it is still a draft to release its " +
              "time, then delete the entry.",
          );
        }

        const result = await TimeEntry.deleteOne({
          _id: entryId,
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
