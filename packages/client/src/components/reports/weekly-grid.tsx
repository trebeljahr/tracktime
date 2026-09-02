"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import type { WeeklyReportResult, WeeklyReportRow } from "@starter/shared";

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
  /** "YYYY-MM-DD" of today, so the current column can be highlighted. */
  todayKey?: string;
};

/**
 * The week at a glance: one row per project+task, one column per weekday.
 *
 * Read-only, deliberately. The cells used to be editable, which meant a cell
 * summing several entries had to pick one of them to rewrite — it took the most
 * recent, silently, which is how a timesheet grid destroys records nobody
 * pointed at. Entering time is the /timesheet screen's job, where the rules for
 * an ambiguous cell are explicit and a cell that cannot be resolved is shown as
 * such instead of accepting the keystroke.
 */
export function WeeklyGrid({
  result,
  duration,
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
                const seconds = row.daySeconds[index] ?? 0;
                return (
                  <TableCell
                    key={day}
                    className={cn(
                      "text-center tabular-nums",
                      seconds === 0 && "text-muted-foreground"
                    )}
                    data-testid={`weekly-cell-${key}-${index}`}
                  >
                    {seconds === 0 ? "–" : duration(seconds)}
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
