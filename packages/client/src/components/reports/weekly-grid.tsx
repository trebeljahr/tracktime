"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import type {
  DurationFormat,
  WeeklyReportResult,
  WeeklyReportRow,
} from "@starter/shared";

import { DurationInput } from "@/components/duration-input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Stable identity for a project+task row, also used for the cell testids. */
export const weeklyRowKey = (row: WeeklyReportRow): string =>
  `${row.projectId ?? "none"}_${row.taskId ?? "none"}`;

const dayHeading = (day: string): { weekday: string; date: string } => {
  const parsed = parseISO(day);
  if (Number.isNaN(parsed.getTime())) return { weekday: day, date: "" };
  return { weekday: format(parsed, "EEE"), date: format(parsed, "d MMM") };
};

export type WeeklyGridProps = {
  result: WeeklyReportResult;
  duration: (seconds: number) => string;
  durationFormat: DurationFormat;
  /** Commit a new total for one cell; the page turns it into entry writes. */
  onCommitCell: (row: WeeklyReportRow, dayIndex: number, seconds: number) => void;
  /** Cells backed by a running timer are read-only until it is stopped. */
  isCellLocked: (row: WeeklyReportRow, dayIndex: number) => boolean;
  disabled?: boolean;
  /** "YYYY-MM-DD" of today, so the current column can be highlighted. */
  todayKey?: string;
};

/**
 * The timesheet grid: one row per project+task, one column per weekday.
 *
 * Every cell is a duration field - typing "1:30" into Wednesday adjusts that
 * day's time for the row, which is how a weekly timesheet is meant to be
 * filled in.
 */
export function WeeklyGrid({
  result,
  duration,
  durationFormat,
  onCommitCell,
  isCellLocked,
  disabled = false,
  todayKey,
}: WeeklyGridProps): React.JSX.Element {
  return (
    <Table data-testid="weekly-grid">
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-56">Project / Task</TableHead>
          {result.days.map((day) => {
            const heading = dayHeading(day);
            return (
              <TableHead
                key={day}
                className={cn(
                  "w-28 text-center",
                  day === todayKey && "text-foreground"
                )}
                data-testid={`weekly-head-${day}`}
              >
                <span className="block text-xs font-medium">
                  {heading.weekday}
                </span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {heading.date}
                </span>
              </TableHead>
            );
          })}
          <TableHead className="w-28 text-right">Total</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {result.rows.map((row) => {
          const key = weeklyRowKey(row);
          return (
            <TableRow key={key} data-testid={`weekly-row-${key}`}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        row.color ?? "hsl(var(--muted-foreground))",
                    }}
                  />
                  <span className="truncate">{row.label}</span>
                </span>
              </TableCell>

              {result.days.map((day, index) => {
                const locked = isCellLocked(row, index);
                return (
                  <TableCell key={day} className="p-1 text-center">
                    <DurationInput
                      value={row.daySeconds[index] ?? 0}
                      format={durationFormat}
                      disabled={disabled || locked}
                      aria-label={`${row.label}, ${day}`}
                      className={cn(
                        "mx-auto w-24",
                        (row.daySeconds[index] ?? 0) === 0 &&
                          "text-muted-foreground"
                      )}
                      onCommit={(seconds) => onCommitCell(row, index, seconds)}
                      testId={`weekly-cell-${key}-${index}`}
                    />
                  </TableCell>
                );
              })}

              <TableCell
                className="text-right font-medium tabular-nums"
                data-testid={`weekly-row-total-${key}`}
              >
                {duration(row.totalSec)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>

      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          {result.dayTotals.map((seconds, index) => (
            <TableCell
              key={result.days[index] ?? index}
              className="text-center tabular-nums"
              data-testid={`weekly-day-total-${index}`}
            >
              {duration(seconds)}
            </TableCell>
          ))}
          <TableCell
            className="text-right tabular-nums"
            data-testid="weekly-grand-total"
          >
            {duration(result.totalSec)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
