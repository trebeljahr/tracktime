"use client";

import * as React from "react";
import { BarChart3, CircleDollarSign, Clock, Receipt } from "lucide-react";
import type { ReportGroupBy } from "@starter/shared";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/reports/export-menu";
import { KpiRow, type KpiItem } from "@/components/reports/kpi-row";
import { openPrintView } from "@/components/reports/print-report";
import { ReportFiltersBar } from "@/components/reports/report-filters";
import {
  ChartSkeleton,
  KpiRowSkeleton,
  ReportPageSkeleton,
  TableSkeleton,
} from "@/components/reports/report-skeletons";
import {
  GroupBreakdownChart,
  TimelineChart,
} from "@/components/reports/summary-charts";
import { SummaryTable } from "@/components/reports/summary-table";
import {
  REPORT_PARAM,
  useReportFilters,
} from "@/components/reports/use-report-filters";
import { formatRangeLabel } from "@/components/date-range-picker";

const GROUP_BY_OPTIONS: { id: ReportGroupBy; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "client", label: "Client" },
  { id: "task", label: "Task" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const isGroupBy = (value: string | null): value is ReportGroupBy =>
  GROUP_BY_OPTIONS.some((option) => option.id === value);

const percent = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(0)}% of tracked time` : "";

function SummaryReport(): React.JSX.Element {
  const filters = useReportFilters();
  const { state, filters: reportFilters, setParam, getParam } = filters;
  const fmt = useFormatSettings();

  const groupByParam = getParam(REPORT_PARAM.groupBy);
  const groupBy: ReportGroupBy = isGroupBy(groupByParam)
    ? groupByParam
    : "project";

  const dimension =
    GROUP_BY_OPTIONS.find((option) => option.id === groupBy)?.label ?? "Project";

  const query = trpc.reports.summary.useQuery(
    { ...reportFilters, groupBy },
    { staleTime: 15_000, placeholderData: (previous) => previous }
  );

  const result = query.data;

  const kpis = React.useMemo<KpiItem[]>(() => {
    const totalSec = result?.totalSec ?? 0;
    const billableSec = result?.billableSec ?? 0;
    const nonBillableSec = Math.max(0, totalSec - billableSec);
    return [
      {
        label: "Total tracked",
        value: fmt.duration(totalSec),
        hint: fmt.durationShort(totalSec),
        icon: Clock,
        testId: "kpi-total",
      },
      {
        label: "Billable",
        value: fmt.duration(billableSec),
        hint: percent(billableSec, totalSec),
        icon: Receipt,
        testId: "kpi-billable",
      },
      {
        label: "Non-billable",
        value: fmt.duration(nonBillableSec),
        hint: percent(nonBillableSec, totalSec),
        icon: Clock,
        testId: "kpi-non-billable",
      },
      {
        label: "Amount earned",
        value: fmt.money(result?.totalAmount ?? 0),
        hint: result?.currency ?? fmt.currency,
        icon: CircleDollarSign,
        testId: "kpi-amount",
      },
    ];
  }, [fmt, result]);

  const handlePrint = React.useCallback((): void => {
    if (!result) return;
    const ok = openPrintView({
      title: `Summary report by ${dimension.toLowerCase()}`,
      subtitle: formatRangeLabel(state.range),
      stats: [
        { label: "Total tracked", value: fmt.duration(result.totalSec) },
        { label: "Billable", value: fmt.duration(result.billableSec) },
        { label: "Amount", value: fmt.money(result.totalAmount) },
      ],
      meta: [
        state.projectIds.length > 0
          ? `${state.projectIds.length} project filter(s)`
          : "All projects",
        state.clientIds.length > 0
          ? `${state.clientIds.length} client filter(s)`
          : "All clients",
        state.billable === "all"
          ? "Billable and non-billable"
          : state.billable === "yes"
            ? "Billable only"
            : "Non-billable only",
        ...(state.search.trim() === "" ? [] : [`Search: ${state.search}`]),
      ],
      columns: [
        { key: "label", header: dimension },
        { key: "billable", header: "Billable", align: "right" },
        { key: "duration", header: "Duration", align: "right" },
        { key: "amount", header: "Amount", align: "right" },
      ],
      rows: [...result.groups]
        .sort((a, b) => b.seconds - a.seconds)
        .map((group) => ({
          label: group.label,
          billable: fmt.duration(group.billableSec),
          duration: fmt.duration(group.seconds),
          amount: fmt.money(group.amount),
        })),
      totals: {
        label: "Total",
        billable: fmt.duration(result.billableSec),
        duration: fmt.duration(result.totalSec),
        amount: fmt.money(result.totalAmount),
      },
    });
    if (!ok) toast.error("Allow pop-ups to open the print view");
  }, [dimension, fmt, result, state]);

  const isLoading = query.isPending;
  const isEmpty = result !== undefined && result.totalSec === 0;

  return (
    <div className="space-y-4" data-testid="summary-report">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Summary</h1>
          <p className="text-sm text-muted-foreground">
            {formatRangeLabel(state.range)}
          </p>
        </div>
      </header>

      <ReportFiltersBar
        filters={filters}
        trailing={
          <ExportMenu
            report="summary"
            filters={reportFilters}
            groupBy={groupBy}
            onPrint={handlePrint}
            disabled={result === undefined}
          />
        }
      />

      {isLoading ? <KpiRowSkeleton /> : <KpiRow items={kpis} />}

      <div
        className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1"
        role="group"
        aria-label="Group by"
        data-testid="groupby-switch"
      >
        <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Group by
        </span>
        {GROUP_BY_OPTIONS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={option.id === groupBy ? "secondary" : "ghost"}
            aria-pressed={option.id === groupBy}
            className={cn("font-normal", option.id === groupBy && "font-medium")}
            onClick={() =>
              setParam(
                REPORT_PARAM.groupBy,
                option.id === "project" ? null : option.id
              )
            }
            data-testid={`groupby-${option.id}`}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton testId="timeline-chart-skeleton" />
          <ChartSkeleton testId="breakdown-chart-skeleton" />
        </div>
      ) : result ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <TimelineChart timeline={result.timeline} duration={fmt.duration} />
          <GroupBreakdownChart
            groups={result.groups}
            totalSec={result.totalSec}
            duration={fmt.duration}
            money={fmt.money}
            dimension={dimension.toLowerCase()}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Totals by {dimension.toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={5} testId="summary-table-skeleton" />
          ) : isEmpty || result === undefined ? (
            <EmptyState
              icon={BarChart3}
              title="No time tracked in this range"
              description="Adjust the filters or track some time, and the numbers will show up here."
              testId="summary-empty"
            />
          ) : (
            <SummaryTable
              groups={result.groups}
              totalSec={result.totalSec}
              billableSec={result.billableSec}
              totalAmount={result.totalAmount}
              duration={fmt.duration}
              money={fmt.money}
              dimensionLabel={dimension}
            />
          )}
        </CardContent>
      </Card>

      {query.isError ? (
        <p className="text-sm text-destructive" data-testid="summary-error">
          {query.error.message}
        </p>
      ) : null}
    </div>
  );
}

export default function SummaryReportPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<ReportPageSkeleton />}>
      <SummaryReport />
    </React.Suspense>
  );
}
