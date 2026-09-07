/**
 * Bulk import of time-tracking history, and the full-workspace export that is
 * its counterpart.
 *
 * The point is onboarding: somebody arriving with years of tracked time
 * elsewhere should be able to drop that history in and keep their reports,
 * rather than starting from an empty database and losing every past total.
 *
 * ── Why no per-vendor importers ──────────────────────────────────────
 *
 * Every tracker exports the same handful of facts under slightly different
 * headers: what was worked on, for which project, when it started, and how
 * long it took. So the importer is written against COLUMN SHAPES, not against
 * products: the header row is matched to {@link ImportColumnRole}s by an alias
 * table, and the resulting {@link ImportShape} says which of the three
 * layouts the file uses. A file nobody anticipated still lands, and the user
 * can re-point any column by hand ({@link ImportColumnOverride}) when the
 * guess is wrong.
 *
 * Everything here is transport-level description of a file the user picked;
 * the parsing itself lives on the server so there is exactly one
 * implementation of it (`services/import/`).
 */
import { z } from "zod";

/** Hard ceilings, enforced server-side. A file past either is refused whole. */
export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_IMPORT_ROWS = 25_000;

/** How many issues and sample rows a preview carries back. */
export const IMPORT_PREVIEW_ISSUES = 50;
export const IMPORT_PREVIEW_ROWS = 20;

/** An entry longer than this is almost certainly a parsing mistake. */
export const MAX_IMPORT_ENTRY_SEC = 24 * 60 * 60;

/**
 * What one column of the file means.
 *
 * `ignored` is a real choice, not an absence: a column the user has explicitly
 * turned off must stay off when the file is re-analyzed on commit.
 */
export const IMPORT_COLUMN_ROLES = [
  "ignored",
  "description",
  "client",
  "project",
  "task",
  "tags",
  "billable",
  /** A full date+time in one cell. */
  "start",
  "end",
  /** A date whose time of day lives in its own column — or nowhere. */
  "date",
  "startTime",
  /**
   * The day the entry ENDED, when the file keeps it apart from the day it
   * started. Without it an overnight entry that ends at 01:00 would be filed
   * as a 22-hour entry ending the same morning it began.
   */
  "endDate",
  "endTime",
  /** "01:30:00", "1.5" or "90m" — normalized to seconds. */
  "duration",
  "rate",
] as const;

export type ImportColumnRole = (typeof IMPORT_COLUMN_ROLES)[number];

export const importColumnRoleSchema = z.enum(IMPORT_COLUMN_ROLES);

/** One column of the file, with the role detection gave it. */
export type ImportColumn = {
  /** Position in the file, 0-based. Stable across re-analysis. */
  index: number;
  header: string;
  role: ImportColumnRole;
  /** True when the role came from the caller rather than from detection. */
  overridden: boolean;
  /** First non-empty value seen, so the UI can show what it is talking about. */
  sample: string | null;
};

/**
 * Which of the three layouts the file uses, decided from the roles present:
 *
 *  - `start-end`      both ends are given; duration is derived and any
 *                     duration column is only a cross-check.
 *  - `start-duration` a start plus how long it lasted.
 *  - `date-duration`  a day and a number of hours, with no clock time at all.
 *                     These get laid out back-to-back from
 *                     {@link IMPORT_DAY_START_HOUR} — see the note there.
 *  - `unusable`       not enough columns to place an entry in time.
 */
export type ImportShape =
  | "start-end"
  | "start-duration"
  | "date-duration"
  | "unusable";

/**
 * Where a date-only row's clock time comes from.
 *
 * A file that records "3.5 hours on the 4th" does not say WHEN, and an
 * importer that spread those rows from midnight would fill everybody's
 * calendar with entries at 2am. Rows are instead stacked back-to-back from
 * 09:00 local, in file order, per day — invented, but invented plausibly, and
 * stated on screen so nobody mistakes it for recorded fact.
 */
export const IMPORT_DAY_START_HOUR = 9;

/**
 * How to read `03/04/2026` — the single most damaging ambiguity in this whole
 * feature, because both readings are valid dates and a wrong guess moves an
 * entry by months without ever failing.
 *
 * It is decided per FILE, not per row: every slashed date in the file is
 * scanned, and one component exceeding 12 anywhere settles it for all of them.
 * `ymd` covers `2026/03/04`. When nothing settles it the preview says so and
 * the user can override — a guess is never made silently.
 */
export type ImportDateOrder = "dmy" | "mdy" | "ymd";

export type ImportIssueCode =
  | "unparsable-start"
  | "unparsable-end"
  | "missing-duration"
  | "nonpositive-duration"
  | "end-before-start"
  | "implausible-duration"
  | "duplicate-in-file"
  | "duplicate-existing"
  | "empty-row";

export type ImportIssue = {
  /** 1-based row number in the file, header excluded. */
  row: number;
  code: ImportIssueCode;
  message: string;
};

/** One row after normalization — the exact entry that would be written. */
export type ImportRow = {
  row: number;
  description: string;
  clientName: string | null;
  projectName: string | null;
  taskName: string | null;
  tagNames: string[];
  /** `null` means the file did not say; the workspace default decides. */
  billable: boolean | null;
  start: string;
  end: string;
  durationSec: number;
  hourlyRate: number | null;
  /**
   * Set when an identical entry already exists — earlier in the same file, or
   * already in the workspace from a previous import.
   */
  duplicateOf: "file" | "workspace" | null;
};

export type ImportFormat = "delimited" | "workspace-json";

/**
 * What a file would do to the workspace, computed without writing anything.
 *
 * The commit re-parses the same text rather than trusting a preview handed
 * back to it, so this is a description, never a token: nothing here is
 * authority to write.
 */
export type ImportPreview = {
  format: ImportFormat;
  /** The character the parser settled on — "," ";" or a tab. */
  delimiter: string;
  shape: ImportShape;
  /** Which way round the file writes slashed dates. See {@link ImportDateOrder}. */
  dateOrder: ImportDateOrder;
  /** True when nothing in the file settled the day/month question either way. */
  dateOrderAmbiguous: boolean;
  columns: ImportColumn[];
  /** Zone the wall-clock readings in the file were interpreted in. */
  timeZone: string;
  totalRows: number;
  readyRows: number;
  skippedRows: number;
  duplicateRows: number;
  totalSec: number;
  firstStart: string | null;
  lastStart: string | null;
  newClients: string[];
  newProjects: string[];
  newTasks: string[];
  newTags: string[];
  /** Capped at {@link IMPORT_PREVIEW_ISSUES}. */
  issues: ImportIssue[];
  /** Capped at {@link IMPORT_PREVIEW_ROWS}. */
  sample: ImportRow[];
};

/** Counts written by one commit — the receipt, and what undo reverses. */
export type ImportResult = {
  batchId: string;
  entriesCreated: number;
  entriesSkipped: number;
  clientsCreated: number;
  projectsCreated: number;
  tasksCreated: number;
  tagsCreated: number;
  totalSec: number;
  firstStart: string | null;
  lastStart: string | null;
};

/** A past import, as listed in the history table. */
export type ImportBatchSummary = ImportResult & {
  filename: string | null;
  createdAt: string;
  undoneAt: string | null;
};

/** Full-workspace export — the format this importer reads back losslessly. */
export type WorkspaceExport = {
  /** Bumped only for a breaking change to the shape below. */
  version: 1;
  exportedAt: string;
  workspaceId: string;
  currency: string;
  clients: WorkspaceExportClient[];
  projects: WorkspaceExportProject[];
  tasks: WorkspaceExportTask[];
  tags: WorkspaceExportTag[];
  entries: WorkspaceExportEntry[];
};

export type WorkspaceExportClient = {
  name: string;
  color: string;
  archived: boolean;
};

export type WorkspaceExportProject = {
  name: string;
  color: string;
  clientName: string | null;
  billableDefault: boolean;
  hourlyRate: number | null;
  estimatedHours: number | null;
  archived: boolean;
};

export type WorkspaceExportTask = {
  name: string;
  projectName: string;
  done: boolean;
  archived: boolean;
};

export type WorkspaceExportTag = {
  name: string;
  color: string;
  archived: boolean;
};

/**
 * Entries reference the catalog BY NAME, not by id.
 *
 * An export that carried ids would only be importable back into the workspace
 * it came from — useless for the two things this format is actually for,
 * moving to a second workspace and keeping an off-site backup that outlives
 * the database it was taken from.
 */
export type WorkspaceExportEntry = {
  description: string;
  clientName: string | null;
  projectName: string | null;
  taskName: string | null;
  tagNames: string[];
  billable: boolean;
  start: string;
  end: string | null;
  durationSec: number;
  hourlyRate: number | null;
  currency: string;
  timeZone: string | null;
};

export const importColumnOverrideSchema = z.object({
  index: z.number().int().min(0).max(512),
  role: importColumnRoleSchema,
});

export type ImportColumnOverride = z.infer<typeof importColumnOverrideSchema>;

/**
 * Everything both `analyze` and `commit` need. The two take the SAME input on
 * purpose: the preview a user approved is only meaningful if the commit reads
 * the file exactly the way the preview did, and the cheapest way to guarantee
 * that is one schema and one parser, run twice.
 */
export const importInputSchema = z.object({
  workspaceId: z.string().optional(),
  originId: z.string().max(64).optional(),
  /** Shown in the history table; never used to decide how to parse. */
  filename: z.string().max(255).optional(),
  text: z.string().min(1).max(MAX_IMPORT_BYTES),
  /** IANA zone the file's wall-clock readings are in. */
  timeZone: z.string().max(64).optional(),
  columns: z.array(importColumnOverrideSchema).max(512).optional(),
  /** Overrides the detected day/month order for slashed dates. */
  dateOrder: z.enum(["dmy", "mdy", "ymd"]).optional(),
  /** Rows matching an existing entry are skipped rather than duplicated. */
  skipDuplicates: z.boolean().optional(),
  /** Create the clients / projects / tasks / tags the file names. */
  createMissing: z.boolean().optional(),
  /** Used when the file has no billable column. */
  defaultBillable: z.boolean().optional(),
});

export type ImportInput = z.infer<typeof importInputSchema>;

export const importUndoSchema = z.object({
  workspaceId: z.string().optional(),
  originId: z.string().max(64).optional(),
  batchId: z.string().min(1),
  /**
   * Also delete the clients / projects / tasks / tags the import created.
   * Off by default: they may have been used by hand since.
   */
  includeCatalog: z.boolean().optional(),
});

export const workspaceExportSchema = z.object({
  workspaceId: z.string().optional(),
  /** Leave both unset to export everything ever tracked. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type ImportUndoResult = {
  batchId: string;
  entriesDeleted: number;
  clientsDeleted: number;
  projectsDeleted: number;
  tasksDeleted: number;
  tagsDeleted: number;
};
