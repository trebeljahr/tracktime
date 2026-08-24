import type { ReportGroupBy, TimeEntry } from "./types.js";

/** Shared filter surface for every report and the entry list. */
export type ReportFilters = {
  /** ISO date or datetime, inclusive. */
  from: string;
  /** ISO date or datetime, exclusive upper bound handling is server-side. */
  to: string;
  projectIds?: string[];
  clientIds?: string[];
  taskIds?: string[];
  billable?: boolean;
  search?: string;
};

export type SummaryReportInput = ReportFilters & { groupBy: ReportGroupBy };

export type SummaryGroup = {
  /** Group identity — project/client/task id, or a date key for time buckets. */
  key: string;
  label: string;
  color: string | null;
  seconds: number;
  billableSec: number;
  amount: number;
};

export type SummaryTimelinePoint = {
  /** Local "YYYY-MM-DD". */
  date: string;
  seconds: number;
  billableSec: number;
};

export type SummaryReportResult = {
  totalSec: number;
  billableSec: number;
  totalAmount: number;
  currency: string;
  groups: SummaryGroup[];
  timeline: SummaryTimelinePoint[];
};

export type DetailedReportInput = ReportFilters & {
  cursor?: string;
  limit?: number;
};

/** A time entry denormalized with its catalog labels and computed earnings. */
export type DetailedEntry = TimeEntry & {
  projectName: string | null;
  projectColor: string | null;
  clientName: string | null;
  taskName: string | null;
  amount: number;
};

export type DetailedReportResult = {
  entries: DetailedEntry[];
  nextCursor?: string;
  totalSec: number;
  totalAmount: number;
  currency: string;
};

export type WeeklyReportInput = ReportFilters & {
  /** ISO date of the first day of the week being rendered. */
  weekStart: string;
};

export type WeeklyReportRow = {
  projectId: string | null;
  taskId: string | null;
  label: string;
  color: string | null;
  /** Seven values, aligned with `days`. */
  daySeconds: number[];
  totalSec: number;
};

export type WeeklyReportResult = {
  /** Seven ISO dates ("YYYY-MM-DD"), Monday-or-Sunday first per settings. */
  days: string[];
  rows: WeeklyReportRow[];
  dayTotals: number[];
  totalSec: number;
};

/** Rows of a CSV export, already stringified by the server. */
export type CsvExportResult = {
  filename: string;
  /** RFC 4180 CSV text. */
  csv: string;
};
