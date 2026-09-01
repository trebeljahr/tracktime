// IMPLEMENTED BY: reports agent
//
// Reporting is the headline feature, so the numbers have to be exactly right.
// The rules this file enforces:
//  - Every query is scoped by `ownerId` — another user's data is simply not
//    there, never a FORBIDDEN.
//  - Durations are integer seconds end to end. Floats only ever appear in
//    money, and only through `entryAmount` / `sumAmounts`.
//  - Entries are CLIPPED to the reported range, so an entry straddling a
//    boundary contributes only its overlapping portion and two adjacent
//    reports never double-count it.
//  - A running entry (`end === null`) counts up to `now`.
//  - Amounts use the per-entry `hourlyRate` snapshot, never the live project
//    rate, so past earnings never shift.
//  - The `timeline` covers every day in the range with zero-filled gaps, and
//    a midnight-crossing entry is split across the days it touches — its day
//    slices always re-sum to exactly its own total, so the timeline can never
//    disagree with `totalSec`.
import { TRPCError } from "@trpc/server";
import mongoose, { Types, type PipelineStage } from "mongoose";
import {
  detailedReportSchema,
  entryAmount,
  entryDurationSec,
  exportCsvSchema,
  formatDuration,
  summaryReportSchema,
  sumAmounts,
  addDaysToKey,
  dayKeyInZone,
  dayKeysBetween,
  monthKeyOf,
  resolveTimeZone,
  splitIntervalByZonedDay,
  weekStartKey,
  zonedDayStartMs,
  type DayKey,
  weeklyReportSchema,
  type CsvExportResult,
  type DetailedEntry,
  type DetailedReportResult,
  type ReportFilters,
  type ReportGroupBy,
  type SummaryGroup,
  type SummaryReportResult,
  type SummaryTimelinePoint,
  type WeekStart,
  type WeeklyReportResult,
  type WeeklyReportRow,
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
import { csvFilename, toCsv, type CsvColumn, type CsvRow } from "../../services/csv.js";
import { protectedProcedure, router } from "../trpc.js";

const DEFAULT_DETAILED_LIMIT = 50;
const EXPORT_PAGE_SIZE = 500;
/** 200 × 500 = 100k entries — far past any real export, but bounded. */
const MAX_EXPORT_PAGES = 200;
const DAYS_PER_WEEK = 7;
/** Ten years of daily buckets — a guard against a nonsense range DoSing us. */
const MAX_TIMELINE_DAYS = 3_700;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const badRequest = (message: string): TRPCError =>
  new TRPCError({ code: "BAD_REQUEST", message });

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── range parsing ────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A bare "YYYY-MM-DD" means a LOCAL calendar day, not UTC midnight — that is
 * how the user picked it in the date picker. A full ISO datetime is taken
 * as-is. `endOfDay` turns a date-only value into the *exclusive* upper bound
 * (local midnight of the following day).
 */
const parseRangeBound = (value: string, endOfDay: boolean): Date => {
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]) + (endOfDay ? 1 : 0),
      0,
      0,
      0,
      0,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`Invalid date: ${value}`);
  }
  return parsed;
};

type Range = { from: Date; to: Date; fromMs: number; toMs: number };

const parseRange = (filters: ReportFilters): Range => {
  const from = parseRangeBound(filters.from, false);
  const to = parseRangeBound(filters.to, true);
  if (to.getTime() <= from.getTime()) {
    throw badRequest("`to` must be after `from`");
  }
  return { from, to, fromMs: from.getTime(), toMs: to.getTime() };
};

/**
 * How this report reads the calendar.
 *
 * Days, weeks and months are resolved in the CALLER's zone. Using the host's
 * own local time meant the server's zone — UTC on a deployment — so a user
 * tracking after midnight had that time filed under the previous day in every
 * report, while the tracker list (grouped in the browser) filed it under the
 * right one.
 */
type Calendar = { timeZone: string; weekStartsOn: WeekStart };

/** Every day key in `[fromMs, toMs)`, inclusive of the last partial day. */
const dayKeysInRange = (
  fromMs: number,
  toMs: number,
  timeZone: string,
): DayKey[] =>
  // `to` is exclusive: a range ending exactly at midnight must not add a day.
  dayKeysBetween(
    dayKeyInZone(fromMs, timeZone),
    dayKeyInZone(toMs - 1, timeZone),
  );


// ── filter → aggregation stages ──────────────────────────────────────

type JoinedEntry = TimeEntryDocLike & {
  _id: unknown;
  project?: ProjectDocLike | null;
  client?: ClientDocLike | null;
  task?: TaskDocLike | null;
};

/**
 * Build the `$match` conditions for a report. Mirrors `entries.list`:
 * overlap semantics (the entry starts before the window ends and either is
 * still running or ended after the window began) and `clientIds` resolved to
 * project ids through the Projects collection.
 *
 * Returns `null` when the filter provably matches nothing (e.g. `clientIds`
 * that own no projects) so callers can short-circuit without a round trip.
 */
const buildMatchConditions = async (
  ownerId: string,
  filters: ReportFilters,
  range: Range,
): Promise<Record<string, unknown>[] | null> => {
  const conditions: Record<string, unknown>[] = [
    { ownerId },
    { start: { $lt: range.to } },
    { $or: [{ end: null }, { end: { $gt: range.from } }] },
  ];

  let projectIds: string[] | null = filters.projectIds ?? null;
  if (filters.clientIds && filters.clientIds.length > 0) {
    const clientProjects = await Project.find({
      ownerId,
      clientId: { $in: filters.clientIds },
    })
      .select("_id")
      .lean();
    const viaClients = clientProjects.map((project) => String(project._id));
    projectIds = projectIds
      ? projectIds.filter((id) => viaClients.includes(id))
      : viaClients;
  }
  if (projectIds) {
    if (projectIds.length === 0) return null;
    conditions.push({ projectId: { $in: projectIds } });
  }

  if (filters.taskIds) {
    if (filters.taskIds.length === 0) return null;
    conditions.push({ taskId: { $in: filters.taskIds } });
  }

  if (typeof filters.billable === "boolean") {
    conditions.push({ billable: filters.billable });
  }

  if (filters.search && filters.search.trim() !== "") {
    conditions.push({
      description: new RegExp(escapeRegExp(filters.search.trim()), "i"),
    });
  }

  return conditions;
};

/**
 * `projectId` / `taskId` / `clientId` are stored as strings, so each join
 * converts to an ObjectId first (`onError: null` keeps a malformed id from
 * blowing up the whole pipeline) before the lookup.
 */
const lookupStages = (): PipelineStage[] => [
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

/**
 * The joins above match on `_id` alone, so re-assert ownership in JS: a
 * dangling or cross-owner reference must read as "no project", never leak a
 * name belonging to somebody else.
 */
const ownedBy = <T extends { ownerId: string }>(
  doc: T | null | undefined,
  ownerId: string,
): T | null => (doc && doc.ownerId === ownerId ? doc : null);

const runJoinedQuery = async (
  ownerId: string,
  conditions: Record<string, unknown>[],
  extraStages: PipelineStage[] = [],
): Promise<JoinedEntry[]> => {
  const pipeline: PipelineStage[] = [
    { $match: { $and: conditions } },
    { $sort: { start: -1, _id: -1 } },
    ...extraStages,
    ...lookupStages(),
  ];
  return TimeEntry.aggregate<JoinedEntry>(pipeline);
};

// ── per-entry measurement ────────────────────────────────────────────

type MeasuredEntry = {
  doc: JoinedEntry;
  /** Seconds inside the reported range — always an integer. */
  seconds: number;
  billableSec: number;
  amount: number;
  /** Local-day slices whose seconds sum to exactly `seconds`. */
  slices: { date: string; seconds: number }[];
  /** Local day the entry *started* on — the bucket for day/week/month groups. */
  /** Calendar day the entry starts on, in the caller's zone. */
  dayKey: DayKey;
};

/**
 * Clip an entry to the range, measure it, and split it across local days.
 *
 * A finished entry that sits entirely inside the range keeps its stored
 * `durationSec` (the authoritative value written on stop) rather than being
 * recomputed from timestamps, so a report can never disagree with the entry
 * list by a rounding second. The day slices are then reconciled against that
 * total so `sum(slices) === seconds` always holds.
 */
const measureEntry = (
  doc: JoinedEntry,
  range: Range,
  nowMs: number,
  calendar: Calendar,
): MeasuredEntry | null => {
  const startMs = doc.start.getTime();
  const rawEndMs = doc.end === null ? nowMs : doc.end.getTime();

  const clipStart = Math.max(startMs, range.fromMs);
  const clipEnd = Math.min(rawEndMs, range.toMs);
  if (!(clipEnd > clipStart)) return null;

  const untouched =
    doc.end !== null &&
    doc.durationSec > 0 &&
    startMs >= range.fromMs &&
    rawEndMs <= range.toMs;

  const seconds = untouched
    ? Math.round(doc.durationSec)
    : Math.max(0, Math.round((clipEnd - clipStart) / 1000));
  if (seconds <= 0) return null;

  const slices = splitIntervalByZonedDay(clipStart, clipEnd, calendar.timeZone);

  // Absorb any rounding drift into the final slice so the day series and the
  // entry total can never diverge.
  const sliced = slices.reduce((total, slice) => total + slice.seconds, 0);
  const last = slices[slices.length - 1];
  if (last && sliced !== seconds) {
    last.seconds = Math.max(0, last.seconds + (seconds - sliced));
  }

  return {
    doc,
    seconds,
    billableSec: doc.billable ? seconds : 0,
    amount: entryAmount(seconds, doc.billable ? doc.hourlyRate : null),
    slices,
    dayKey: dayKeyInZone(clipStart, calendar.timeZone),
  };
};

// ── grouping ─────────────────────────────────────────────────────────

type GroupIdentity = { key: string; label: string; color: string | null };

const NO_PROJECT: GroupIdentity = {
  key: "none",
  label: "No project",
  color: null,
};

const groupIdentity = (
  measured: MeasuredEntry,
  groupBy: ReportGroupBy,
  ownerId: string,
  calendar: Calendar,
): GroupIdentity => {
  const { doc } = measured;
  const project = ownedBy(doc.project, ownerId);
  const client = ownedBy(doc.client, ownerId);
  const task = ownedBy(doc.task, ownerId);

  switch (groupBy) {
    case "project":
      return project
        ? { key: String(project._id), label: project.name, color: project.color }
        : NO_PROJECT;

    case "client":
      return client
        ? { key: String(client._id), label: client.name, color: client.color }
        : { key: "none", label: "No client", color: null };

    case "task":
      return task
        ? {
            key: String(task._id),
            label: task.name,
            color: project?.color ?? null,
          }
        : { key: "none", label: "No task", color: null };

    case "day": {
      const key = measured.dayKey;
      return { key, label: key, color: null };
    }

    case "week": {
      const key = weekStartKey(measured.dayKey, calendar.weekStartsOn);
      const weekEnd = addDaysToKey(key, DAYS_PER_WEEK - 1);
      return { key, label: `${key} – ${weekEnd}`, color: null };
    }

    case "month": {
      const key = monthKeyOf(measured.dayKey);
      const month = Number(key.slice(5, 7)) - 1;
      const year = key.slice(0, 4);
      return {
        key,
        label: `${MONTH_NAMES[month] ?? key} ${year}`,
        color: null,
      };
    }
  }
};

type GroupAccumulator = GroupIdentity & {
  seconds: number;
  billableSec: number;
  amounts: number[];
};

// ── report bodies (shared by the queries and by exportCsv) ───────────

const emptySummary = (currency: string, range: Range, timeZone: string): SummaryReportResult => ({
  totalSec: 0,
  billableSec: 0,
  totalAmount: 0,
  currency,
  groups: [],
  timeline: dayKeysInRange(range.fromMs, range.toMs, timeZone).map((date) => ({
    date,
    seconds: 0,
    billableSec: 0,
  })),
});

const buildSummary = async (
  ownerId: string,
  filters: ReportFilters,
  groupBy: ReportGroupBy,
): Promise<SummaryReportResult> => {
  const settings = await getOrCreateSettings(ownerId);
  const range = parseRange(filters);
  const nowMs = Date.now();
  const calendar: Calendar = {
    timeZone: resolveTimeZone(filters.timeZone),
    weekStartsOn: settings.weekStartsOn,
  };

  const conditions = await buildMatchConditions(ownerId, filters, range);
  if (conditions === null)
    return emptySummary(settings.currency, range, calendar.timeZone);

  const docs = await runJoinedQuery(ownerId, conditions);

  const timeline = new Map<string, SummaryTimelinePoint>();
  for (const date of dayKeysInRange(range.fromMs, range.toMs, calendar.timeZone)) {
    timeline.set(date, { date, seconds: 0, billableSec: 0 });
  }

  const groups = new Map<string, GroupAccumulator>();
  let totalSec = 0;
  let billableSec = 0;
  const amounts: number[] = [];

  for (const doc of docs) {
    const measured = measureEntry(doc, range, nowMs, calendar);
    if (!measured) continue;

    totalSec += measured.seconds;
    billableSec += measured.billableSec;
    if (measured.amount !== 0) amounts.push(measured.amount);

    const identity = groupIdentity(measured, groupBy, ownerId, calendar);
    const group = groups.get(identity.key) ?? {
      ...identity,
      seconds: 0,
      billableSec: 0,
      amounts: [],
    };
    group.seconds += measured.seconds;
    group.billableSec += measured.billableSec;
    if (measured.amount !== 0) group.amounts.push(measured.amount);
    groups.set(identity.key, group);

    for (const slice of measured.slices) {
      // A slice can fall outside the timeline only if the clip math and the
      // day enumeration disagree; skip rather than invent a bucket.
      const point = timeline.get(slice.date);
      if (!point) continue;
      point.seconds += slice.seconds;
      if (doc.billable) point.billableSec += slice.seconds;
    }
  }

  const sortedGroups: SummaryGroup[] = [...groups.values()]
    .map(({ key, label, color, seconds, billableSec: groupBillable, amounts: groupAmounts }) => ({
      key,
      label,
      color,
      seconds,
      billableSec: groupBillable,
      amount: sumAmounts(groupAmounts),
    }))
    .sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key));

  return {
    totalSec,
    billableSec,
    totalAmount: sumAmounts(amounts),
    currency: settings.currency,
    groups: sortedGroups,
    timeline: [...timeline.values()],
  };
};

const encodeCursor = (start: Date, id: string): string =>
  `${start.toISOString()}|${id}`;

type DecodedCursor = { start: Date; id: Types.ObjectId };

const decodeCursor = (cursor: string): DecodedCursor | null => {
  const separator = cursor.lastIndexOf("|");
  if (separator === -1) return null;
  const rawId = cursor.slice(separator + 1);
  if (!mongoose.isValidObjectId(rawId)) return null;
  const startMs = Date.parse(cursor.slice(0, separator));
  if (!Number.isFinite(startMs)) return null;
  return { start: new Date(startMs), id: new Types.ObjectId(rawId) };
};

const toDetailedEntry = (
  measured: MeasuredEntry,
  ownerId: string,
): DetailedEntry => {
  const { doc } = measured;
  const project = ownedBy(doc.project, ownerId);
  const client = ownedBy(doc.client, ownerId);
  const task = ownedBy(doc.task, ownerId);

  return {
    ...toClientTimeEntry(doc),
    projectName: project?.name ?? null,
    projectColor: project?.color ?? null,
    clientName: client?.name ?? null,
    taskName: task?.name ?? null,
    amount: measured.amount,
  };
};

const buildDetailed = async (
  ownerId: string,
  filters: ReportFilters,
  page: { cursor?: string; limit?: number },
  /**
   * Range totals cost a full scan of the filtered set. The CSV export walks
   * every page, so it asks for them once and skips them on subsequent pages.
   */
  withTotals = true,
): Promise<DetailedReportResult> => {
  const settings = await getOrCreateSettings(ownerId);
  const range = parseRange(filters);
  const nowMs = Date.now();
  const limit = page.limit ?? DEFAULT_DETAILED_LIMIT;

  const conditions = await buildMatchConditions(ownerId, filters, range);
  if (conditions === null) {
    return {
      entries: [],
      totalSec: 0,
      totalAmount: 0,
      currency: settings.currency,
    };
  }

  // Range totals cover the WHOLE filtered set, not the current page — a
  // paginated total would be a lie on every page but the last.
  const allMatching = withTotals
    ? await TimeEntry.find({ $and: conditions })
        .select("start end durationSec billable hourlyRate")
        .lean()
    : [];

  let totalSec = 0;
  const amounts: number[] = [];
  for (const entry of allMatching) {
    const startMs = entry.start.getTime();
    const rawEndMs = entry.end === null ? nowMs : entry.end.getTime();
    const clipStart = Math.max(startMs, range.fromMs);
    const clipEnd = Math.min(rawEndMs, range.toMs);
    if (!(clipEnd > clipStart)) continue;

    const untouched =
      entry.end !== null &&
      entry.durationSec > 0 &&
      startMs >= range.fromMs &&
      rawEndMs <= range.toMs;
    const seconds = untouched
      ? Math.round(entry.durationSec)
      : Math.max(0, Math.round((clipEnd - clipStart) / 1000));
    if (seconds <= 0) continue;

    totalSec += seconds;
    const amount = entryAmount(seconds, entry.billable ? entry.hourlyRate : null);
    if (amount !== 0) amounts.push(amount);
  }

  const pageConditions = [...conditions];
  if (page.cursor) {
    const cursor = decodeCursor(page.cursor);
    if (!cursor) throw badRequest("Invalid cursor");
    pageConditions.push({
      $or: [
        { start: { $lt: cursor.start } },
        { start: cursor.start, _id: { $lt: cursor.id } },
      ],
    });
  }

  const docs = await runJoinedQuery(ownerId, pageConditions, [
    { $limit: limit + 1 },
  ]);

  const window = docs.slice(0, limit);
  const entries = window
    .map((doc) =>
      measureEntry(doc, range, nowMs, {
        timeZone: resolveTimeZone(filters.timeZone),
        weekStartsOn: settings.weekStartsOn,
      }),
    )
    .filter((measured): measured is MeasuredEntry => measured !== null)
    .map((measured) => toDetailedEntry(measured, ownerId));

  const lastDoc = window[window.length - 1];
  const nextCursor =
    docs.length > limit && lastDoc
      ? encodeCursor(lastDoc.start, String(lastDoc._id))
      : undefined;

  return {
    entries,
    ...(nextCursor ? { nextCursor } : {}),
    totalSec,
    totalAmount: sumAmounts(amounts),
    currency: settings.currency,
  };
};

const buildWeekly = async (
  ownerId: string,
  filters: ReportFilters,
  weekStart: string,
): Promise<WeeklyReportResult> => {
  const settings = await getOrCreateSettings(ownerId);
  const nowMs = Date.now();
  const calendar: Calendar = {
    timeZone: resolveTimeZone(filters.timeZone),
    weekStartsOn: settings.weekStartsOn,
  };

  // The week window is authoritative for the date range; `from`/`to` on the
  // filters only bound which week the caller may ask for. The grid must always
  // be exactly seven days wide starting at `weekStart`.
  const firstKey = dayKeyInZone(
    parseRangeBound(weekStart, false).getTime(),
    calendar.timeZone,
  );
  const days: DayKey[] = [];
  for (let index = 0; index < DAYS_PER_WEEK; index += 1) {
    days.push(addDaysToKey(firstKey, index));
  }

  // The grid's window is the seven zoned days themselves, so a week is exactly
  // the time between local midnights — 167 or 169 hours across a DST shift.
  const fromMs = zonedDayStartMs(firstKey, calendar.timeZone);
  const toMs = zonedDayStartMs(
    addDaysToKey(firstKey, DAYS_PER_WEEK),
    calendar.timeZone,
  );
  const range: Range = {
    from: new Date(fromMs),
    to: new Date(toMs),
    fromMs,
    toMs,
  };
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const dayTotals = days.map(() => 0);

  const conditions = await buildMatchConditions(ownerId, filters, range);
  if (conditions === null) {
    return { days, rows: [], dayTotals, totalSec: 0 };
  }

  const docs = await runJoinedQuery(ownerId, conditions);

  const rows = new Map<string, WeeklyReportRow>();
  let totalSec = 0;

  for (const doc of docs) {
    const measured = measureEntry(doc, range, nowMs, calendar);
    if (!measured) continue;

    const project = ownedBy(doc.project, ownerId);
    const task = ownedBy(doc.task, ownerId);
    const projectId = project ? String(project._id) : null;
    const taskId = task ? String(task._id) : null;
    const rowKey = `${projectId ?? ""}::${taskId ?? ""}`;
    const projectLabel = project?.name ?? NO_PROJECT.label;

    const row = rows.get(rowKey) ?? {
      projectId,
      taskId,
      label: task ? `${projectLabel} – ${task.name}` : projectLabel,
      color: project?.color ?? null,
      daySeconds: days.map(() => 0),
      totalSec: 0,
    };

    for (const slice of measured.slices) {
      const index = dayIndex.get(slice.date);
      if (index === undefined) continue;
      row.daySeconds[index] = (row.daySeconds[index] ?? 0) + slice.seconds;
      dayTotals[index] = (dayTotals[index] ?? 0) + slice.seconds;
      row.totalSec += slice.seconds;
      totalSec += slice.seconds;
    }

    rows.set(rowKey, row);
  }

  const sortedRows = [...rows.values()]
    .filter((row) => row.totalSec > 0)
    .sort((a, b) => b.totalSec - a.totalSec || a.label.localeCompare(b.label));

  return { days, rows: sortedRows, dayTotals, totalSec };
};

// ── CSV serialization ────────────────────────────────────────────────

/** Hours as a decimal, 2dp — what people paste into an invoice. */
const decimalHours = (seconds: number): number =>
  Math.round((seconds / 3600) * 100) / 100;

const SUMMARY_COLUMNS: CsvColumn[] = [
  { key: "label", header: "Group" },
  { key: "duration", header: "Duration" },
  { key: "hours", header: "Hours" },
  { key: "seconds", header: "Seconds" },
  { key: "billableHours", header: "Billable hours" },
  { key: "billableSeconds", header: "Billable seconds" },
  { key: "amount", header: "Amount" },
  { key: "currency", header: "Currency" },
];

const summaryCsvRows = (result: SummaryReportResult): CsvRow[] =>
  result.groups.map((group) => ({
    label: group.label,
    duration: formatDuration(group.seconds, "hms"),
    hours: decimalHours(group.seconds),
    seconds: group.seconds,
    billableHours: decimalHours(group.billableSec),
    billableSeconds: group.billableSec,
    amount: group.amount,
    currency: result.currency,
  }));

const DETAILED_COLUMNS: CsvColumn[] = [
  { key: "date", header: "Date" },
  { key: "start", header: "Start" },
  { key: "end", header: "End" },
  { key: "duration", header: "Duration" },
  { key: "hours", header: "Hours" },
  { key: "seconds", header: "Seconds" },
  { key: "description", header: "Description" },
  { key: "project", header: "Project" },
  { key: "client", header: "Client" },
  { key: "task", header: "Task" },
  { key: "billable", header: "Billable" },
  { key: "rate", header: "Rate" },
  { key: "amount", header: "Amount" },
  { key: "currency", header: "Currency" },
  { key: "source", header: "Source" },
  { key: "id", header: "Id" },
];

const detailedCsvRows = (
  result: DetailedReportResult,
  timeZone: string,
): CsvRow[] => {
  const nowMs = Date.now();
  return result.entries.map((entry) => {
    const seconds = entryDurationSec(entry, nowMs);
    return {
      date: dayKeyInZone(Date.parse(entry.start), timeZone),
      start: entry.start,
      end: entry.end,
      duration: formatDuration(seconds, "hms"),
      hours: decimalHours(seconds),
      seconds,
      description: entry.description,
      project: entry.projectName,
      client: entry.clientName,
      task: entry.taskName,
      billable: entry.billable ? "yes" : "no",
      rate: entry.hourlyRate,
      amount: entry.amount,
      currency: entry.currency,
      source: entry.source,
      id: entry.id,
    };
  });
};

const weeklyCsvColumns = (result: WeeklyReportResult): CsvColumn[] => [
  { key: "label", header: "Project / Task" },
  ...result.days.map((day) => ({ key: `day:${day}`, header: day })),
  { key: "total", header: "Total" },
];

const weeklyCsvRows = (result: WeeklyReportResult): CsvRow[] =>
  result.rows.map((row) => {
    const csvRow: CsvRow = {
      label: row.label,
      total: decimalHours(row.totalSec),
    };
    result.days.forEach((day, index) => {
      csvRow[`day:${day}`] = decimalHours(row.daySeconds[index] ?? 0);
    });
    return csvRow;
  });

/** The CSV filename carries the range so a folder of exports stays readable. */
const exportFilename = (
  report: string,
  range: Range,
  timeZone: string,
): string =>
  csvFilename(
    report,
    dayKeyInZone(range.fromMs, timeZone),
    dayKeyInZone(range.toMs - 1, timeZone),
  );

type CsvExport = CsvExportResult & { mimeType: "text/csv" };

// ── router ───────────────────────────────────────────────────────────

export const reportsRouter = router({
  /** Totals, grouped breakdown and a zero-filled daily series for charts. */
  summary: protectedProcedure
    .input(summaryReportSchema)
    .query(async ({ ctx, input }): Promise<SummaryReportResult> => {
      return buildSummary(ctx.user.id, input, input.groupBy);
    }),

  /** Flat, paginated entry log; totals always span the full filtered range. */
  detailed: protectedProcedure
    .input(detailedReportSchema)
    .query(async ({ ctx, input }): Promise<DetailedReportResult> => {
      return buildDetailed(ctx.user.id, input, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      });
    }),

  /** Seven-day timesheet grid, one row per project+task combination. */
  weekly: protectedProcedure
    .input(weeklyReportSchema)
    .query(async ({ ctx, input }): Promise<WeeklyReportResult> => {
      return buildWeekly(ctx.user.id, input, input.weekStart);
    }),

  /** Runs the matching report and serializes it for download. */
  exportCsv: protectedProcedure
    .input(exportCsvSchema)
    .query(async ({ ctx, input }): Promise<CsvExport> => {
      const ownerId = ctx.user.id;
      const range = parseRange(input);
      const exportZone = resolveTimeZone(input.timeZone);

      if (input.report === "summary") {
        const result = await buildSummary(
          ownerId,
          input,
          input.groupBy ?? "project",
        );
        return {
          filename: exportFilename("summary", range, exportZone),
          csv: toCsv(summaryCsvRows(result), SUMMARY_COLUMNS),
          mimeType: "text/csv",
        };
      }

      if (input.report === "weekly") {
        const weekStart =
          input.weekStart ?? dayKeyInZone(range.fromMs, exportZone);
        const result = await buildWeekly(ownerId, input, weekStart);
        return {
          filename: exportFilename("weekly", range, exportZone),
          csv: toCsv(weeklyCsvRows(result), weeklyCsvColumns(result)),
          mimeType: "text/csv",
        };
      }

      // Detailed: paginate through the whole range so the export is complete,
      // not just the page the UI happens to be showing.
      const entries: DetailedEntry[] = [];
      let currency = "";
      let cursor: string | undefined;
      let guard = 0;

      do {
        const pageResult: DetailedReportResult = await buildDetailed(
          ownerId,
          input,
          { limit: EXPORT_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
          false,
        );
        entries.push(...pageResult.entries);
        currency = pageResult.currency;
        cursor = pageResult.nextCursor;
        guard += 1;
      } while (cursor && guard < MAX_EXPORT_PAGES);

      return {
        filename: exportFilename("detailed", range, exportZone),
        csv: toCsv(
          detailedCsvRows(
            { entries, totalSec: 0, totalAmount: 0, currency },
            exportZone,
          ),
          DETAILED_COLUMNS,
        ),
        mimeType: "text/csv",
      };
    }),
});
