import { z } from "zod";

export const createItemSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
});

export const updateItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

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

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
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
export const entrySourceSchema = z.enum(["web", "desktop", "mobile", "api"]);
export const reportGroupBySchema = z.enum([
  "project",
  "client",
  "task",
  "day",
  "week",
  "month",
]);

const originId = z.string().max(64).optional();
const idString = z.string().min(1);
const entryDescription = z.string().max(500);

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

// ── projects ─────────────────────────────────────────────────────────

export const projectListSchema = z.object({
  includeArchived: z.boolean().optional(),
  clientId: idString.nullish(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  color: hexColorSchema.optional(),
  clientId: idString.nullish(),
  billableDefault: z.boolean().optional(),
  hourlyRate: hourlyRateSchema.nullish(),
  originId,
});

export const updateProjectSchema = z.object({
  id: idString,
  name: z.string().min(1).max(120).optional(),
  color: hexColorSchema.optional(),
  clientId: idString.nullish(),
  billableDefault: z.boolean().optional(),
  hourlyRate: hourlyRateSchema.nullish(),
  archived: z.boolean().optional(),
  originId,
});

// ── tasks ────────────────────────────────────────────────────────────

export const taskListSchema = z.object({
  projectId: idString,
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
  originId,
});

export const stopTimerSchema = z.object({
  /** Defaults to the currently running entry when omitted. */
  id: idString.optional(),
  /** Defaults to "now" on the server when omitted. */
  end: isoDateTimeSchema.optional(),
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
    originId,
  })
  .refine(endAfterStart, endAfterStartIssue);

export const entryListSchema = z.object({
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  projectIds: z.array(idString).optional(),
  clientIds: z.array(idString).optional(),
  taskIds: z.array(idString).optional(),
  billable: z.boolean().optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

// ── reports ──────────────────────────────────────────────────────────

export const reportFiltersSchema = z.object({
  from: isoDateOrDateTimeSchema,
  to: isoDateOrDateTimeSchema,
  projectIds: z.array(idString).optional(),
  clientIds: z.array(idString).optional(),
  taskIds: z.array(idString).optional(),
  billable: z.boolean().optional(),
  search: z.string().max(200).optional(),
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

// ── settings & tokens ────────────────────────────────────────────────

export const pomodoroSettingsSchema = z.object({
  enabled: z.boolean(),
  workMinutes: z.number().int().min(1).max(180),
  breakMinutes: z.number().int().min(1).max(120),
  longBreakMinutes: z.number().int().min(1).max(180),
  cyclesBeforeLongBreak: z.number().int().min(1).max(12),
  notify: z.boolean(),
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
  pomodoro: pomodoroSettingsSchema.partial().optional(),
  originId,
});

export const createTokenSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  originId,
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
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type EntryListInput = z.infer<typeof entryListSchema>;
export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;
export type SummaryReportSchemaInput = z.infer<typeof summaryReportSchema>;
export type DetailedReportSchemaInput = z.infer<typeof detailedReportSchema>;
export type WeeklyReportSchemaInput = z.infer<typeof weeklyReportSchema>;
export type ExportCsvInput = z.infer<typeof exportCsvSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
