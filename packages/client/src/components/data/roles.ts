import { IMPORT_COLUMN_ROLES, type ImportColumnRole } from "@starter/shared";

/**
 * Column roles as a person would name them.
 *
 * Written from the user's side of the question — they are looking at a column
 * of their own file and answering "what is this?", not learning the importer's
 * vocabulary. So the labels say what the DATA is, and the hints say when to
 * pick one over its neighbour.
 */
export const ROLE_LABELS: Record<ImportColumnRole, string> = {
  ignored: "Don't import",
  description: "Description",
  client: "Client",
  project: "Project",
  task: "Task",
  tags: "Tags",
  billable: "Billable",
  start: "Start (date and time)",
  end: "End (date and time)",
  date: "Date",
  startTime: "Start time",
  endDate: "End date",
  endTime: "End time",
  duration: "Duration",
  rate: "Hourly rate",
};

/** Offered in the picker, in the order the questions actually come up. */
export const ROLE_OPTIONS: ImportColumnRole[] = [
  "ignored",
  "description",
  "project",
  "client",
  "task",
  "tags",
  "billable",
  "start",
  "end",
  "date",
  "startTime",
  "endDate",
  "endTime",
  "duration",
  "rate",
];

/** A guard for values arriving from a `<Select>`, which speaks only strings. */
export const isImportColumnRole = (value: string): value is ImportColumnRole =>
  (IMPORT_COLUMN_ROLES as readonly string[]).includes(value);
