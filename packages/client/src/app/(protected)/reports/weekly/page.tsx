"use client";

import * as React from "react";
import { addDays, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  toLocalDateKey,
  type DetailedEntry,
  type WeeklyReportRow,
} from "@starter/shared";

import { formatRangeLabel, toDateKey } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { ExportMenu } from "@/components/reports/export-menu";
import { KpiRow, type KpiItem } from "@/components/reports/kpi-row";
import { openPrintView } from "@/components/reports/print-report";
import { ReportFiltersBar } from "@/components/reports/report-filters";
import {
  KpiRowSkeleton,
  ReportPageSkeleton,
  TableSkeleton,
} from "@/components/reports/report-skeletons";
import {
  REPORT_PARAM,
  useReportFilters,
} from "@/components/reports/use-report-filters";
import { WeeklyGrid, weeklyRowKey } from "@/components/reports/weekly-grid";

const DAYS_PER_WEEK = 7;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** New cells are seeded at 09:00 local - a plausible start of a working day. */
const DEFAULT_START_HOUR = "T09:00:00";

const sameId = (a: string | null, b: string | null): boolean => a === b;

function WeeklyReport(): React.JSX.Element {
  const filters = useReportFilters();
  const { filters: reportFilters, weekStartsOn, getParam, setParam } = filters;
  const fmt = useFormatSettings();
  const utils = trpc.useUtils();

  // ── which week ─────────────────────────────────────────────────────
  const weekParam = getParam(REPORT_PARAM.week);
  const currentWeekStart = React.useMemo(
    () => toDateKey(startOfWeek(new Date(), { weekStartsOn })),
    [weekStartsOn]
  );
  const weekStart =
    weekParam !== null && DAY_KEY.test(weekParam) ? weekParam : currentWeekStart;

  const weekEnd = React.useMemo(
    () => toDateKey(addDays(parseISO(weekStart), DAYS_PER_WEEK - 1)),
    [weekStart]
  );

  const shiftWeek = React.useCallback(
    (offset: number): void => {
      const next = toDateKey(addWeeks(parseISO(weekStart), offset));
      setParam(REPORT_PARAM.week, next === currentWeekStart ? null : next);
    },
    [currentWeekStart, setParam, weekStart]
  );

  // The week window is authoritative for this report, so the shared from/to
  // params never narrow it - only the catalogue filters apply.
  const weekFilters = React.useMemo(
    () => ({ ...reportFilters, from: weekStart, to: weekEnd }),
    [reportFilters, weekEnd, weekStart]
  );
  const weeklyInput = React.useMemo(
    () => ({ ...weekFilters, weekStart }),
    [weekFilters, weekStart]
  );

  const query = trpc.reports.weekly.useQuery(weeklyInput, {
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });

  // The grid shows totals; editing a cell needs the entries behind it.
  const entriesQuery = trpc.entries.list.useQuery(
    { ...weekFilters, limit: 500 },
    { staleTime: 15_000 }
  );

  const result = query.data;
  const listedEntries = React.useMemo<DetailedEntry[]>(
    () => entriesQuery.data?.entries ?? [],
    [entriesQuery.data]
  );

  const entriesForCell = React.useCallback(
    (row: WeeklyReportRow, dayIndex: number): DetailedEntry[] => {
      const day = result?.days[dayIndex];
      if (day === undefined) return [];
      return listedEntries
        .filter(
          (entry) =>
            sameId(entry.projectId, row.projectId) &&
            sameId(entry.taskId, row.taskId) &&
            toLocalDateKey(new Date(entry.start)) === day
        )
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    },
    [listedEntries, result]
  );

  const isCellLocked = React.useCallback(
    (row: WeeklyReportRow, dayIndex: number): boolean =>
      entriesForCell(row, dayIndex).some((entry) => entry.end === null),
    [entriesForCell]
  );

  // ── cell editing ───────────────────────────────────────────────────
  const createEntry = trpc.entries.create.useMutation();
  const updateEntry = trpc.entries.update.useMutation();
  const removeEntry = trpc.entries.remove.useMutation();

  const optimisticCell = React.useCallback(
    (rowKey: string, dayIndex: number, seconds: number): void => {
      utils.reports.weekly.setData(weeklyInput, (old) => {
        if (!old) return old;
        const target = old.rows.find((row) => weeklyRowKey(row) === rowKey);
        if (target === undefined) return old;
        const previous = target.daySeconds[dayIndex] ?? 0;
        const delta = seconds - previous;

        return {
          ...old,
          rows: old.rows.map((row) => {
            if (weeklyRowKey(row) !== rowKey) return row;
            const daySeconds = [...row.daySeconds];
            daySeconds[dayIndex] = seconds;
            return { ...row, daySeconds, totalSec: row.totalSec + delta };
          }),
          dayTotals: old.dayTotals.map((total, index) =>
            index === dayIndex ? Math.max(0, total + delta) : total
          ),
          totalSec: Math.max(0, old.totalSec + delta),
        };
      });
    },
    [utils, weeklyInput]
  );

  const handleCommitCell = React.useCallback(
    (row: WeeklyReportRow, dayIndex: number, seconds: number): void => {
      const day = result?.days[dayIndex];
      if (day === undefined) return;

      const target = Math.max(0, Math.round(seconds));
      const current = row.daySeconds[dayIndex] ?? 0;
      const delta = target - current;
      if (delta === 0) return;

      const cellEntries = entriesForCell(row, dayIndex);
      const last = cellEntries[cellEntries.length - 1];

      // Work out the single write this edit maps to before touching the cache,
      // so an impossible edit never leaves an optimistic value on screen.
      let perform: (() => Promise<unknown>) | null = null;

      if (last === undefined) {
        if (target === 0) return;
        const start = new Date(`${day}${DEFAULT_START_HOUR}`);
        if (Number.isNaN(start.getTime())) return;
        const end = new Date(start.getTime() + target * 1000);
        perform = () =>
          createEntry.mutateAsync({
            description: "",
            projectId: row.projectId,
            taskId: row.taskId,
            start: start.toISOString(),
            end: end.toISOString(),
            source: "web",
            originId: ORIGIN_ID,
          });
      } else {
        const nextDuration = last.durationSec + delta;
        if (nextDuration > 0) {
          const end = new Date(
            Date.parse(last.start) + nextDuration * 1000
          ).toISOString();
          perform = () =>
            updateEntry.mutateAsync({ id: last.id, end, originId: ORIGIN_ID });
        } else if (cellEntries.length === 1 && target === 0) {
          perform = () =>
            removeEntry.mutateAsync({ id: last.id, originId: ORIGIN_ID });
        } else {
          toast.error(
            "Shorten the other entries on this day before reducing the total"
          );
          return;
        }
      }

      const rowKey = weeklyRowKey(row);

      void (async () => {
        await utils.reports.weekly.cancel(weeklyInput);
        const snapshot = utils.reports.weekly.getData(weeklyInput);
        optimisticCell(rowKey, dayIndex, target);

        try {
          await perform();
        } catch (error) {
          utils.reports.weekly.setData(weeklyInput, snapshot);
          toast.error(
            error instanceof Error ? error.message : "Could not save the change"
          );
        } finally {
          void utils.reports.invalidate();
          void utils.entries.invalidate();
        }
      })();
    },
    [
      createEntry,
      entriesForCell,
      optimisticCell,
      removeEntry,
      result,
      updateEntry,
      utils,
      weeklyInput,
    ]
  );

  // ── export ─────────────────────────────────────────────────────────
  const handlePrint = React.useCallback((): void => {
    if (!result) return;
    const ok = openPrintView({
      title: "Weekly timesheet",
      subtitle: formatRangeLabel({ from: weekStart, to: weekEnd }),
      stats: [
        { label: "Week total", value: fmt.duration(result.totalSec) },
        {
          label: "Rows",
          value: String(result.rows.length),
        },
      ],
      columns: [
        { key: "label", header: "Project / Task" },
        ...result.days.map((day) => ({
          key: day,
          header: format(parseISO(day), "EEE d"),
          align: "right" as const,
        })),
        { key: "total", header: "Total", align: "right" as const },
      ],
      rows: result.rows.map((row) => {
        const printRow: Record<string, string> = {
          label: row.label,
          total: fmt.duration(row.totalSec),
        };
        result.days.forEach((day, index) => {
          printRow[day] = fmt.duration(row.daySeconds[index] ?? 0);
        });
        return printRow;
      }),
      totals: result.days.reduce<Record<string, string>>(
        (accumulator, day, index) => {
          accumulator[day] = fmt.duration(result.dayTotals[index] ?? 0);
          return accumulator;
        },
        { label: "Total", total: fmt.duration(result.totalSec) }
      ),
    });
    if (!ok) toast.error("Allow pop-ups to open the print view");
  }, [fmt, result, weekEnd, weekStart]);

  const daysWithTime = (result?.dayTotals ?? []).filter(
    (seconds) => seconds > 0
  ).length;

  const kpis = React.useMemo<KpiItem[]>(
    () => [
      {
        label: "Week total",
        value: fmt.duration(result?.totalSec ?? 0),
        hint: formatRangeLabel({ from: weekStart, to: weekEnd }),
        icon: Clock,
        testId: "kpi-total",
      },
      {
        label: "Daily average",
        value: fmt.duration(
          daysWithTime > 0 ? Math.round((result?.totalSec ?? 0) / daysWithTime) : 0
        ),
        hint: `Across ${daysWithTime} day${daysWithTime === 1 ? "" : "s"} tracked`,
        icon: CalendarRange,
        testId: "kpi-daily-average",
      },
    ],
    [daysWithTime, fmt, result, weekEnd, weekStart]
  );

  const isLoading = query.isPending;
  const todayKey = toDateKey(new Date());

  const weekNav = (
    <div className="flex items-center gap-1" data-testid="week-nav">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Previous week"
        onClick={() => shiftWeek(-1)}
        data-testid="week-prev"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-w-44 font-normal"
        onClick={() => setParam(REPORT_PARAM.week, null)}
        data-testid="week-current"
      >
        {formatRangeLabel({ from: weekStart, to: weekEnd })}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Next week"
        onClick={() => shiftWeek(1)}
        data-testid="week-next"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="weekly-report">
      <header>
        <h1 className="text-xl font-semibold">Weekly timesheet</h1>
        <p className="text-sm text-muted-foreground">
          {formatRangeLabel({ from: weekStart, to: weekEnd })}
        </p>
      </header>

      <ReportFiltersBar
        filters={filters}
        hideDateRange
        leading={weekNav}
        trailing={
          <ExportMenu
            report="weekly"
            filters={weekFilters}
            weekStart={weekStart}
            onPrint={handlePrint}
            disabled={result === undefined}
          />
        }
      />

      {isLoading ? <KpiRowSkeleton /> : <KpiRow items={kpis} />}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <TableSkeleton rows={6} columns={9} testId="weekly-grid-skeleton" />
          ) : result === undefined || result.rows.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="Nothing tracked this week"
              description="Start a timer or add an entry, and it will show up in this grid ready to edit."
              testId="weekly-empty"
            />
          ) : (
            <WeeklyGrid
              result={result}
              duration={fmt.duration}
              durationFormat={fmt.durationFormat}
              onCommitCell={handleCommitCell}
              isCellLocked={isCellLocked}
              disabled={entriesQuery.isPending}
              todayKey={todayKey}
            />
          )}
        </CardContent>
      </Card>

      {query.isError ? (
        <p className="text-sm text-destructive" data-testid="weekly-error">
          {query.error.message}
        </p>
      ) : null}
    </div>
  );
}

export default function WeeklyReportPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<ReportPageSkeleton />}>
      <WeeklyReport />
    </React.Suspense>
  );
}
