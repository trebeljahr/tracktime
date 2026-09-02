"use client";

import * as React from "react";
import Link from "next/link";
import { addDays, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Grid3x3,
} from "lucide-react";

import { formatRangeLabel, toDateKey } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
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
import { WeeklyGrid } from "@/components/reports/weekly-grid";

const DAYS_PER_WEEK = 7;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function WeeklyReport(): React.JSX.Element {
  const filters = useReportFilters();
  const { filters: reportFilters, weekStartsOn, getParam, setParam } = filters;
  const fmt = useFormatSettings();

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

  const result = query.data;

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

  const timesheetLink = (
    <Button asChild variant="outline" size="sm" data-testid="weekly-open-timesheet">
      <Link href={`/timesheet?week=${weekStart}`}>
        <Grid3x3 className="size-4" />
        Fill in the timesheet
      </Link>
    </Button>
  );

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
        <h1 className="text-xl font-semibold">Weekly report</h1>
        <p className="text-sm text-muted-foreground">
          {formatRangeLabel({ from: weekStart, to: weekEnd })}
        </p>
      </header>

      <ReportFiltersBar
        filters={filters}
        hideDateRange
        leading={weekNav}
        trailing={
          <>
            {timesheetLink}
            <ExportMenu
              report="weekly"
              filters={weekFilters}
              weekStart={weekStart}
              onPrint={handlePrint}
              disabled={result === undefined}
            />
          </>
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
              description="Start a timer, or fill the week in on the timesheet, and it will show up here."
              testId="weekly-empty"
            />
          ) : (
            <WeeklyGrid
              result={result}
              duration={fmt.duration}
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
