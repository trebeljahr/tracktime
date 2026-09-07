"use client";

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import {
  formatDurationShort,
  IMPORT_DAY_START_HOUR,
  type ImportColumnRole,
  type ImportDateOrder,
  type ImportPreview,
} from "@starter/shared";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isImportColumnRole, ROLE_LABELS, ROLE_OPTIONS } from "./roles";

export type ImportPreviewViewProps = {
  preview: ImportPreview;
  /** Re-point one column; the caller re-analyzes with the override applied. */
  onRoleChange: (index: number, role: ImportColumnRole) => void;
  onDateOrderChange: (order: ImportDateOrder) => void;
  busy: boolean;
};

const DATE_ORDER_LABELS: Record<ImportDateOrder, string> = {
  dmy: "Day first (31/12/2026)",
  mdy: "Month first (12/31/2026)",
  ymd: "Year first (2026-12-31)",
};

const shortDate = (iso: string | null): string =>
  iso === null
    ? "—"
    : new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

const shortTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One number and what it counts. */
function Stat(props: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <div
        className={
          props.tone === "muted"
            ? "text-xl font-semibold text-muted-foreground"
            : "text-xl font-semibold"
        }
      >
        {props.value}
      </div>
      <div className="text-xs text-muted-foreground">{props.label}</div>
    </div>
  );
}

function Note(props: {
  tone: "info" | "warning";
  testId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const Icon = props.tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      data-testid={props.testId}
      className={
        props.tone === "warning"
          ? "flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          : "flex gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{props.children}</div>
    </div>
  );
}

/** "1 entry" / "3 entries" — a stat that reads as a sentence, not a template. */
export const pluralEntries = (count: number): string =>
  count === 1 ? "entry" : "entries";

/** A list of names, truncated with a count once it stops being readable. */
const nameList = (names: readonly string[], limit = 8): string => {
  if (names.length === 0) return "none";
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit
    ? `${shown} and ${names.length - limit} more`
    : shown;
};

/**
 * What the file would do, before it does it.
 *
 * The mapping table is editable because detection is a guess: every column
 * carries the role it was given and the first value it holds, so the guess can
 * be checked against the data rather than against the header alone.
 */
export function ImportPreviewView({
  preview,
  onRoleChange,
  onDateOrderChange,
  busy,
}: ImportPreviewViewProps): React.JSX.Element {
  const unreadable = preview.totalRows - preview.readyRows - preview.duplicateRows;

  return (
    <div className="space-y-4" data-testid="import-preview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={`${pluralEntries(preview.readyRows)} to import`}
          value={String(preview.readyRows)}
        />
        <Stat label="already here" value={String(preview.duplicateRows)} tone="muted" />
        <Stat
          label={`row${unreadable === 1 ? "" : "s"} not readable`}
          value={String(Math.max(0, unreadable))}
          tone="muted"
        />
        <Stat label="tracked time" value={formatDurationShort(preview.totalSec)} />
      </div>

      <p className="text-sm text-muted-foreground" data-testid="import-range">
        {preview.readyRows === 0
          ? "Nothing new in this file."
          : `${shortDate(preview.firstStart)} to ${shortDate(preview.lastStart)}, read as ${preview.timeZone} time.`}
      </p>

      {preview.dateOrderAmbiguous ? (
        <Note tone="warning">
          Every date in this file could be read either way round —{" "}
          <strong>03/04</strong> is the 3rd of April or the 4th of March. Pick
          the one your file means before importing.
        </Note>
      ) : null}

      {preview.sections.moneyRedacted ? (
        <Note tone="warning" testId="import-money-redacted">
          <strong>This file&rsquo;s money was blanked when it was exported.</strong>{" "}
          Entries, catalog and times import in full, but every rate in it is
          empty, so the imported history is priced by this workspace&rsquo;s
          own rates rather than the ones it was tracked at.
        </Note>
      ) : null}

      {preview.sections.invoices > 0 ? (
        <Note tone="info" testId="import-invoices-dropped">
          {preview.sections.invoices} invoice
          {preview.sections.invoices === 1 ? "" : "s"} in this file{" "}
          {preview.sections.invoices === 1 ? "is" : "are"} not imported — an
          issued invoice records something that happened, and re-creating it
          here would either bill nothing or bill the wrong hours twice.
        </Note>
      ) : null}

      {preview.shape === "date-duration" ? (
        <Note tone="info">
          This file records a day and a length, but no clock time. Entries are
          laid out back-to-back from {IMPORT_DAY_START_HOUR}:00 in file order,
          so each day adds up correctly even though the times of day are
          invented.
        </Note>
      ) : null}

      {preview.columns.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Columns</h4>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Dates
              <Select
                value={preview.dateOrder}
                onValueChange={(value) => {
                  if (value === "dmy" || value === "mdy" || value === "ymd") {
                    onDateOrderChange(value);
                  }
                }}
                disabled={busy}
              >
                <SelectTrigger
                  className="h-8 w-56"
                  aria-label="How dates are written"
                  data-testid="import-date-order"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["dmy", "mdy", "ymd"] as const).map((order) => (
                    <SelectItem key={order} value={order}>
                      {DATE_ORDER_LABELS[order]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>First value</TableHead>
                  <TableHead className="w-56">Imported as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.columns.map((column) => (
                  <TableRow key={column.index}>
                    <TableCell className="font-medium">
                      {column.header || `Column ${column.index + 1}`}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {column.sample ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={column.role}
                        onValueChange={(value) => {
                          if (isImportColumnRole(value)) {
                            onRoleChange(column.index, value);
                          }
                        }}
                        disabled={busy}
                      >
                        <SelectTrigger
                          className="h-8"
                          aria-label={`Role for ${column.header}`}
                          data-testid={`import-column-${column.index}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="space-y-1 text-sm">
        <h4 className="font-medium">This import will also create</h4>
        <ul className="text-muted-foreground">
          <li data-testid="import-new-clients">
            Clients: {nameList(preview.newClients)}
          </li>
          <li data-testid="import-new-projects">
            Projects: {nameList(preview.newProjects)}
          </li>
          <li>Tasks: {preview.newTasks.length}</li>
          <li data-testid="import-new-tags">Tags: {nameList(preview.newTags)}</li>
        </ul>
      </div>

      {preview.sample.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            First {preview.sample.length} entries
          </h4>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Start</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sample.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell className="whitespace-nowrap">
                      {shortTime(row.start)}
                    </TableCell>
                    <TableCell>{formatDurationShort(row.durationSec)}</TableCell>
                    <TableCell className="max-w-64 truncate">
                      {row.description || (
                        <span className="text-muted-foreground">No description</span>
                      )}
                    </TableCell>
                    <TableCell>{row.projectName ?? "—"}</TableCell>
                    <TableCell className="space-x-1">
                      {row.tagNames.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {preview.issues.length > 0 ? (
        <details className="rounded-md border p-3" data-testid="import-issues">
          <summary className="cursor-pointer text-sm font-medium">
            {preview.issues.length} row
            {preview.issues.length === 1 ? "" : "s"} need attention
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {preview.issues.map((item) => (
              <li key={`${item.row}-${item.code}`}>
                Row {item.row}: {item.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
