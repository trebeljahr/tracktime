import { z } from "zod";

import {
  IDLE_BEHAVIORS,
  MAX_IDLE_THRESHOLD_MINUTES,
  MIN_IDLE_THRESHOLD_MINUTES,
} from "./idle.js";
import {
  MAX_MAX_DURATION_HOURS,
  MIN_MAX_DURATION_HOURS,
  RUNAWAY_BEHAVIORS,
  RUNAWAY_RESOLUTIONS,
  type RunawayResolution,
} from "./runaway.js";
import type { IdleBehavior, RunawayBehavior } from "./types.js";

export const updateProfileSchema = z.object({
  bio: z.string().max(500).optional(),
  avatarUrl: z.url().optional(),
  preferences: z
    .object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      notifications: z.boolean().optional(),
    })
    .optional(),
});

// ── tracktime schemas ────────────────────────────────────────────────

/** Hex color like "#4f46e5". */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex value like #4f46e5");

/** ISO datetime string ("2026-08-21T09:15:00Z" or with a numeric offset). */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Either a calendar date ("2026-08-21") or a full ISO datetime. */
export const isoDateOrDateTimeSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);

export const hourlyRateSchema = z.number().min(0).max(1_000_000);

/** ISO 4217 code, e.g. "EUR". */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO 4217 code")
  .transform((value) => value.toUpperCase());

/** Lifetime hours a project is estimated at. 0 is a real estimate; null is not. */
export const estimatedHoursSchema = z.number().min(0).max(100_000);

/** Lifetime money budget for a project. */
export const budgetAmountSchema = z.number().min(0).max(1_000_000_000);
export const entrySourceSchema = z.enum([
  "web",
  "desktop",
  "mobile",
  "extension",
  "api",
  "import",
]);
/**
 * Declared from the shared behaviour lists rather than repeating the literals,
 * so a new behaviour cannot be added to a type and silently rejected by
 * validation.
 */
export const idleBehaviorSchema = z.enum(
  IDLE_BEHAVIORS as unknown as [IdleBehavior, ...IdleBehavior[]],
);

export const runawayBehaviorSchema = z.enum(
  RUNAWAY_BEHAVIORS as unknown as [RunawayBehavior, ...RunawayBehavior[]],
);

export const runawayResolutionSchema = z.enum(
  RUNAWAY_RESOLUTIONS as unknown as [RunawayResolution, ...RunawayResolution[]],
);

export const reportGroupBySchema = z.enum([
  "project",
  "client",
  "task",
  "tag",
  "day",
  "week",
  "month",
]);

const originId = z.string().max(64).optional();
const idString = z.string().min(1);
const entryDescription = z.string().max(500);

/**
 * Tags on one entry. Capped at 20 because the cap is what keeps the write
 * bounded — an unbounded array on a hot document is how a single entry ends
 * up carrying a kilobyte of ids.
 */
const entryTagIds = z.array(idString).max(20).optional();

/** Generic `{ id }` mutation input — archive / remove / continue / get. */
export const idInputSchema = z.object({ id: idString, originId });

/** `end` (when present) must be strictly after `start`. */
const endAfterStart = (value: {
  start?: string | null;
  end?: string | null;
}): boolean => {
  if (!value.start || !value.end) return true;
  return Date.parse(value.end) > Date.parse(value.start);
};
const endAfterStartIssue: { message: string; path: PropertyKey[] } = {
  message: "End must be after start",
  path: ["end"],
};

// ── clients ──────────────────────────────────────────────────────────

export const clientListSchema = z.object({
  includeArchived: z.boolean().optional(),
});

/**
 * IANA zone the client recording the entry is in. Optional so older clients and
 * the extensions keep working; entries without one fall back to the viewer's
 * zone at display time.
 */
const entryTimeZone = z.string().max(64).optional();

export const createClientSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  color: hexColorSchema.optional(),
  originId,
});

export const updateClientSchema = z.object({
  id: idString,
  name: z.string().min(1).max(120).optional(),
  color: hexColorSchema.optional(),
  archived: z.boolean().optional(),
  originId,
});

// ── tags ─────────────────────────────────────────────────────────────

export const tagListSchema = z.object({
  includeArchived: z.boolean().optional(),
});

export const createTagSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  color: hexColorSchema.optional(),
  originId,
});

export const updateTagSchema = z.object({
  id: idString,
  name: z.string().min(1).max(60).optional(),
  color: hexColorSchema.optional(),
  archived: z.boolean().optional(),
  originId,
});

// ── projects ─────────────────────────────────────────────────────────

export const projectListSchema = z.object({
  includeArchived: z.boolean().optional(),
  clientId: idString.nullish(),
});

/**
 * Budget fields are `nullish` on purpose: absent leaves the target alone,
 * explicit null clears it. A budget of 0 is neither — it is a real target the
 * project is already over.
 */
const projectBudgetFields = {
  estimatedHours: estimatedHoursSchema.nullish(),
  budgetAmount: budgetAmountSchema.nullish(),
  /** Defaults to the workspace currency when a budget is set without one. */
  budgetCurrency: currencyCodeSchema.nullish(),
};

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  color: hexColorSchema.optional(),
  clientId: idString.nullish(),
  billableDefault: z.boolean().optional(),
  hourlyRate: hourlyRateSchema.nullish(),
  ...projectBudgetFields,
  /** null/omitted inherits `WorkspaceSettings.idle.behavior`. */
  idleBehavior: idleBehaviorSchema.nullish(),
  originId,
});

export const updateProjectSchema = z.object({
  id: idString,
  name: z.string().min(1).max(120).optional(),
  color: hexColorSchema.optional(),
  clientId: idString.nullish(),
  billableDefault: z.boolean().optional(),
  hourlyRate: hourlyRateSchema.nullish(),
  ...projectBudgetFields,
  idleBehavior: idleBehaviorSchema.nullish(),
  archived: z.boolean().optional(),
  originId,
});

// ── tasks ────────────────────────────────────────────────────────────

/**
 * `projectId` is optional so the Tasks screen can list every task the owner
 * has; the project row's inline panel still scopes itself to one project.
 */
export const taskListSchema = z.object({
  projectId: idString.nullish(),
  includeArchived: z.boolean().optional(),
});

export const createTaskSchema = z.object({
  projectId: idString,
  name: z.string().min(1, "Name is required").max(200),
  originId,
});

export const updateTaskSchema = z.object({
  id: idString,
  name: z.string().min(1).max(200).optional(),
  done: z.boolean().optional(),
  archived: z.boolean().optional(),
  originId,
});

// ── timer / entries ──────────────────────────────────────────────────

export const startTimerSchema = z.object({
  description: entryDescription.optional(),
  projectId: idString.nullish(),
  taskId: idString.nullish(),
  billable: z.boolean().optional(),
  /** Defaults to "now" on the server when omitted. */
  start: isoDateTimeSchema.optional(),
  source: entrySourceSchema.optional(),
  timeZone: entryTimeZone,
  tagIds: entryTagIds,
  originId,
});

export const stopTimerSchema = z.object({
  /** Defaults to the currently running entry when omitted. */
  id: idString.optional(),
  /** Defaults to "now" on the server when omitted. */
  end: isoDateTimeSchema.optional(),
  originId,
});

/**
 * Continuing an entry opens a NEW one, recorded wherever the caller is now, so
 * it carries a zone of its own rather than inheriting the original's.
 */
export const continueEntrySchema = z.object({
  id: idString,
  timeZone: entryTimeZone,
  originId,
});

export const createEntrySchema = z
  .object({
    description: entryDescription.default(""),
    projectId: idString.nullish(),
    taskId: idString.nullish(),
    billable: z.boolean().optional(),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    source: entrySourceSchema.optional(),
    timeZone: entryTimeZone,
    tagIds: entryTagIds,
    originId,
  })
  .refine(endAfterStart, endAfterStartIssue);

export const updateEntrySchema = z
  .object({
    id: idString,
    description: entryDescription.optional(),
    projectId: idString.nullish(),
    taskId: idString.nullish(),
    billable: z.boolean().optional(),
    start: isoDateTimeSchema.optional(),
    /** null keeps/creates a running entry. */
    end: isoDateTimeSchema.nullish(),
    /** Replaces the whole set — omit to leave the entry's tags untouched. */
    tagIds: entryTagIds,
    originId,
  })
  .refine(endAfterStart, endAfterStartIssue);

export const entryListSchema = z.object({
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  projectIds: z.array(idString).optional(),
  clientIds: z.array(idString).optional(),
  taskIds: z.array(idString).optional(),
  /** FILTER: keep entries carrying at least one of these tags. */
  tagIds: z.array(idString).max(20).optional(),
  billable: z.boolean().optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

// ── favorites & recents ──────────────────────────────────────────────

/**
 * The four fields that decide what a timer tracks. Shared by `favorites.create`
 * and by whatever a client pins from, so the two cannot drift apart.
 */
const quickStartFields = {
  description: entryDescription.default(""),
  projectId: idString.nullish(),
  taskId: idString.nullish(),
  /** Omitted falls back to the project's `billableDefault`, as `start` does. */
  billable: z.boolean().optional(),
};

/**
 * Answering the runaway prompt.
 *
 * `end` is read only for the `end-at` resolution; `cap` and `restore` are
 * recomputed on the server from the mark, so a stale client cannot move the
 * boundary to an instant the guard never measured.
 */
export const resolveRunawaySchema = z.object({
  id: idString,
  resolution: runawayResolutionSchema,
  end: isoDateTimeSchema.optional(),
  originId,
});

export const createFavoriteSchema = z.object({ ...quickStartFields, originId });

/**
 * Reordering ships the whole list, not a from/to pair. A pair would need the
 * server to trust the client's idea of the current order; a full list is
 * idempotent and survives two devices reordering at once — last write wins on
 * an order everyone can see, rather than on an offset nobody can verify.
 */
export const reorderFavoritesSchema = z.object({
  ids: z.array(idString).max(200),
  originId,
});

/**
 * Recents look back over a window rather than all of history: a combination
 * last tracked a year ago is not what "start the thing you do every day"
 * means, and scanning the whole log to find it would cost more every month.
 */
export const recentEntriesSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  days: z.number().int().min(1).max(365).optional(),
});

// ── reports ──────────────────────────────────────────────────────────

export const reportFiltersSchema = z.object({
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  projectIds: z.array(idString).optional(),
  clientIds: z.array(idString).optional(),
  taskIds: z.array(idString).optional(),
  /** FILTER: keep entries carrying at least one of these tags (OR). */
  tagIds: z.array(idString).max(20).optional(),
  billable: z.boolean().optional(),
  search: z.string().max(200).optional(),
  /**
   * IANA zone the caller wants days bucketed in, e.g. "Europe/Berlin".
   * Without it the server would answer with its own zone — usually UTC on a
   * deployment — and file after-midnight work under the previous day.
   */
  timeZone: z.string().max(64).optional(),
});

export const summaryReportSchema = reportFiltersSchema.extend({
  groupBy: reportGroupBySchema,
});

export const detailedReportSchema = reportFiltersSchema.extend({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const weeklyReportSchema = reportFiltersSchema.extend({
  weekStart: isoDateOrDateTimeSchema,
});

export const exportCsvSchema = reportFiltersSchema.extend({
  report: z.enum(["summary", "detailed", "weekly"]),
  /** Required when `report === "summary"`. */
  groupBy: reportGroupBySchema.optional(),
  /** Required when `report === "weekly"`. */
  weekStart: isoDateOrDateTimeSchema.optional(),
});

/**
 * Same surface as {@link exportCsvSchema} — the two exports answer the same
 * question in two file formats, so keeping the inputs identical means a UI can
 * flip between them without rebuilding the request.
 */
export const exportPdfSchema = reportFiltersSchema.extend({
  report: z.enum(["summary", "detailed", "weekly"]),
  /** Required when `report === "summary"`. */
  groupBy: reportGroupBySchema.optional(),
  /** Required when `report === "weekly"`. */
  weekStart: isoDateOrDateTimeSchema.optional(),
});

// ── invoicing ────────────────────────────────────────────────────────

/** Line granularity: one line per project, or one per task. */
export const invoiceGroupBySchema = z.enum(["project", "task"]);

export const invoiceStatusSchema = z.enum(["draft", "sent", "paid"]);

/** Percent, e.g. 19 for 19% VAT. Null / absent means no tax line. */
export const taxRateSchema = z.number().min(0).max(100);

/**
 * Dry run: roll billable time up into lines WITHOUT writing anything, so the
 * UI can show exactly what would be invoiced before committing to a number.
 */
export const invoicePreviewSchema = z.object({
  clientId: idString,
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  groupBy: invoiceGroupBySchema.default("project"),
  taxRate: taxRateSchema.nullish(),
});

export const createInvoiceSchema = z.object({
  clientId: idString,
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  groupBy: invoiceGroupBySchema.default("project"),
  taxRate: taxRateSchema.nullish(),
  issueDate: isoDateOrDateTimeSchema,
  dueDate: isoDateOrDateTimeSchema,
  /** Server-generated when omitted; must stay unique per owner. */
  number: z.string().min(1).max(40).optional(),
  notes: z.string().max(2_000).optional(),
  originId,
});

export const updateInvoiceStatusSchema = z.object({
  id: idString,
  status: invoiceStatusSchema,
  originId,
});

export const invoiceListSchema = z.object({
  status: invoiceStatusSchema.optional(),
  clientId: idString.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const invoicePdfSchema = z.object({ id: idString });

// ── settings & tokens ────────────────────────────────────────────────

export const idleSettingsSchema = z.object({
  enabled: z.boolean(),
  thresholdMinutes: z
    .number()
    .int()
    .min(MIN_IDLE_THRESHOLD_MINUTES)
    .max(MAX_IDLE_THRESHOLD_MINUTES),
  behavior: idleBehaviorSchema,
  lockIsImmediate: z.boolean(),
});

export const maxDurationSettingsSchema = z.object({
  /**
   * `0` is the off switch, which is why the minimum is not
   * MIN_MAX_DURATION_HOURS. Anything between 0 and the minimum would be a
   * guard that fires on entries nobody has finished starting yet.
   */
  maxHours: z
    .number()
    .int()
    .refine(
      (hours) =>
        hours === 0 ||
        (hours >= MIN_MAX_DURATION_HOURS && hours <= MAX_MAX_DURATION_HOURS),
      `Maximum duration must be 0 (off) or between ${MIN_MAX_DURATION_HOURS} and ${MAX_MAX_DURATION_HOURS} hours`,
    ),
  behavior: runawayBehaviorSchema,
});

export const updateSettingsSchema = z.object({
  defaultHourlyRate: hourlyRateSchema.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code")
    .optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  durationFormat: z.enum(["hms", "decimal"]).optional(),
  idle: idleSettingsSchema.partial().optional(),
  maxDuration: maxDurationSettingsSchema.partial().optional(),
  originId,
});

/** Revoking one device session. `id` is the session id, never its token. */
export const revokeDeviceSchema = z.object({
  id: z.string().min(1),
  originId,
});

/** Sign every other device out, keeping the current one. */
export const revokeOtherDevicesSchema = z.object({ originId });

/** Approving or denying a device-flow pairing code typed by the user. */
export const deviceCodeSchema = z.object({
  userCode: z
    .string()
    .min(4, "Enter the code shown on your device")
    .max(32)
    .transform((value) => value.trim().toUpperCase()),
});

// ── inferred input types ─────────────────────────────────────────────

export type IdInput = z.infer<typeof idInputSchema>;
export type ClientListInput = z.infer<typeof clientListSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ProjectListInput = z.infer<typeof projectListSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type TaskListInput = z.infer<typeof taskListSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type StopTimerInput = z.infer<typeof stopTimerSchema>;
export type ContinueEntryInput = z.infer<typeof continueEntrySchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type EntryListInput = z.infer<typeof entryListSchema>;
export type CreateFavoriteInput = z.infer<typeof createFavoriteSchema>;
export type ReorderFavoritesInput = z.infer<typeof reorderFavoritesSchema>;
export type RecentEntriesInput = z.infer<typeof recentEntriesSchema>;
export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;
export type SummaryReportSchemaInput = z.infer<typeof summaryReportSchema>;
export type DetailedReportSchemaInput = z.infer<typeof detailedReportSchema>;
export type WeeklyReportSchemaInput = z.infer<typeof weeklyReportSchema>;
export type ExportCsvInput = z.infer<typeof exportCsvSchema>;
export type ExportPdfInput = z.infer<typeof exportPdfSchema>;
export type TagListInput = z.infer<typeof tagListSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type InvoicePreviewInput = z.infer<typeof invoicePreviewSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceStatusInput = z.infer<
  typeof updateInvoiceStatusSchema
>;
export type InvoiceListInput = z.infer<typeof invoiceListSchema>;
export type InvoicePdfInput = z.infer<typeof invoicePdfSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type MaxDurationSettingsInput = z.infer<
  typeof maxDurationSettingsSchema
>;
export type ResolveRunawayInput = z.infer<typeof resolveRunawaySchema>;
export type RevokeDeviceInput = z.infer<typeof revokeDeviceSchema>;
export type RevokeOtherDevicesInput = z.infer<typeof revokeOtherDevicesSchema>;
export type DeviceCodeInput = z.infer<typeof deviceCodeSchema>;
