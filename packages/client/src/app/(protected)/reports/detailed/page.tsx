"use client";

import * as React from "react";
import { Clock, ListChecks, Loader2, Table2 } from "lucide-react";
import {
  entryAmount,
  resolveHourlyRate,
  type DetailedEntry,
} from "@starter/shared";

import { formatRangeLabel } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { CURRENCY_FALLBACK_ICON, currencyIcon } from "@/lib/currency";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { BulkActionBar } from "@/components/reports/bulk-action-bar";
import {
  DEFAULT_DETAILED_SORT,
  DetailedTable,
  sortDetailedEntries,
  type DetailedSort,
  type DetailedSortField,
  type SortDirection,
} from "@/components/reports/detailed-table";
import { ExportMenu } from "@/components/reports/export-menu";
import { KpiRow, type KpiItem } from "@/components/reports/kpi-row";
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

const PAGE_SIZE = 50;

/** Mutates one entry in the cached page and returns it, or null to drop it. */
type EntryPatch = (entry: DetailedEntry) => DetailedEntry | null;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function DetailedReport(): React.JSX.Element {
  const filters = useReportFilters();
  const { state, filters: reportFilters, getParam, setParams } = filters;
  const fmt = useFormatSettings();
  const utils = trpc.useUtils();

  const input = React.useMemo(
    () => ({ ...reportFilters, limit: PAGE_SIZE }),
    [reportFilters]
  );

  const query = trpc.reports.detailed.useInfiniteQuery(input, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    staleTime: 15_000,
  });

  const projectsQuery = trpc.projects.list.useQuery({});
  const projectsById = React.useMemo(() => {
    const map = new Map<
      string,
      { name: string; color: string; clientName: string | null; hourlyRate: number | null }
    >();
    for (const project of projectsQuery.data ?? []) {
      map.set(project.id, {
        name: project.name,
        color: project.color,
        clientName: project.clientName,
        hourlyRate: project.hourlyRate,
      });
    }
    return map;
  }, [projectsQuery.data]);

  // ── sorting (URL-backed, applied to the loaded pages) ──────────────
  const sortField = getParam(REPORT_PARAM.sort);
  const sortDir = getParam(REPORT_PARAM.dir);
  const sort = React.useMemo<DetailedSort>(
    () => ({
      field: sortField === "duration" ? "duration" : DEFAULT_DETAILED_SORT.field,
      direction: sortDir === "asc" ? "asc" : DEFAULT_DETAILED_SORT.direction,
    }),
    [sortDir, sortField]
  );

  const handleSort = React.useCallback(
    (field: DetailedSortField): void => {
      const nextDirection: SortDirection =
        sort.field === field && sort.direction === "desc" ? "asc" : "desc";
      setParams({
        [REPORT_PARAM.sort]: field === "date" ? null : field,
        [REPORT_PARAM.dir]: nextDirection === "desc" ? null : nextDirection,
      });
    },
    [setParams, sort.direction, sort.field]
  );

  const pages = React.useMemo(() => query.data?.pages ?? [], [query.data]);
  const loadedEntries = React.useMemo(
    () => pages.flatMap((page) => page.entries),
    [pages]
  );
  const entries = React.useMemo(
    () => sortDetailedEntries(loadedEntries, sort),
    [loadedEntries, sort]
  );
  const totals = pages[0];

  // ── selection ──────────────────────────────────────────────────────
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );

  // A filter change reloads a different set of rows, so a selection made
  // against the old set must not survive it.
  const filterKey = JSON.stringify(reportFilters);
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    if (selected.size > 0) setSelected(new Set());
  }

  const toggle = React.useCallback((id: string, isSelected: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(
    (isSelected: boolean): void => {
      setSelected(
        isSelected ? new Set(loadedEntries.map((entry) => entry.id)) : new Set()
      );
    },
    [loadedEntries]
  );

  // ── bulk mutations, optimistic over the infinite cache ─────────────
  const updateEntry = trpc.entries.update.useMutation();
  const removeEntry = trpc.entries.remove.useMutation();
  const [bulkPending, setBulkPending] = React.useState(false);

  const runBulk = React.useCallback(
    (
      ids: string[],
      patch: EntryPatch,
      perform: (id: string) => Promise<unknown>,
      successMessage: string
    ): void => {
      if (ids.length === 0) return;
      const targets = new Set(ids);
      setBulkPending(true);

      void (async () => {
        await utils.reports.detailed.cancel(input);
        const snapshot = utils.reports.detailed.getInfiniteData(input);

        utils.reports.detailed.setInfiniteData(input, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => {
              let secondsDelta = 0;
              let amountDelta = 0;
              const next: DetailedEntry[] = [];
              for (const entry of page.entries) {
                if (!targets.has(entry.id)) {
                  next.push(entry);
                  continue;
                }
                const patched = patch(entry);
                if (patched === null) {
                  secondsDelta += entry.durationSec;
                  amountDelta += entry.amount;
                  continue;
                }
                next.push(patched);
                amountDelta += entry.amount - patched.amount;
              }
              return {
                ...page,
                entries: next,
                totalSec: Math.max(0, page.totalSec - secondsDelta),
                totalAmount: round2(page.totalAmount - amountDelta),
              };
            }),
          };
        });

        try {
          await Promise.all(ids.map(perform));
          setSelected(new Set());
          toast.success(successMessage);
        } catch (error) {
          utils.reports.detailed.setInfiniteData(input, () => snapshot);
          toast.error(
            error instanceof Error ? error.message : "Bulk update failed"
          );
        } finally {
          setBulkPending(false);
          void utils.reports.invalidate();
          void utils.entries.invalidate();
        }
      })();
    },
    [input, utils]
  );

  const selectedIds = React.useMemo(() => [...selected], [selected]);

  const handleSetProject = React.useCallback(
    (projectId: string | null): void => {
      const project = projectId === null ? undefined : projectsById.get(projectId);
      runBulk(
        selectedIds,
        (entry) => {
          const rate = resolveHourlyRate({
            billable: entry.billable,
            projectRate: project?.hourlyRate ?? null,
            defaultRate: fmt.settings.defaultHourlyRate,
          });
          return {
            ...entry,
            projectId,
            // The task belonged to the previous project, so it cannot survive.
            taskId: null,
            projectName: project?.name ?? null,
            projectColor: project?.color ?? null,
            clientName: project?.clientName ?? null,
            taskName: null,
            hourlyRate: rate,
            amount: entryAmount(entry.durationSec, rate),
          };
        },
        (id) =>
          updateEntry.mutateAsync({
            id,
            projectId,
            taskId: null,
            originId: ORIGIN_ID,
          }),
        projectId === null
          ? `Removed the project from ${selectedIds.length} entries`
          : `Moved ${selectedIds.length} entries to ${project?.name ?? "the project"}`
      );
    },
    [fmt.settings.defaultHourlyRate, projectsById, runBulk, selectedIds, updateEntry]
  );

  const handleSetBillable = React.useCallback(
    (billable: boolean): void => {
      runBulk(
        selectedIds,
        (entry) => {
          const project =
            entry.projectId === null
              ? undefined
              : projectsById.get(entry.projectId);
          const rate = resolveHourlyRate({
            billable,
            projectRate: project?.hourlyRate ?? null,
            defaultRate: fmt.settings.defaultHourlyRate,
          });
          return {
            ...entry,
            billable,
            hourlyRate: rate,
            amount: entryAmount(entry.durationSec, rate),
          };
        },
        (id) => updateEntry.mutateAsync({ id, billable, originId: ORIGIN_ID }),
        `Marked ${selectedIds.length} entries ${billable ? "billable" : "non-billable"}`
      );
    },
    [fmt.settings.defaultHourlyRate, projectsById, runBulk, selectedIds, updateEntry]
  );

  const handleDelete = React.useCallback((): void => {
    runBulk(
      selectedIds,
      () => null,
      (id) => removeEntry.mutateAsync({ id, originId: ORIGIN_ID }),
      `Deleted ${selectedIds.length} entries`
    );
  }, [removeEntry, runBulk, selectedIds]);

  // ── export ─────────────────────────────────────────────────────────
  const kpis = React.useMemo<KpiItem[]>(
    () => [
      {
        label: "Total tracked",
        value: fmt.duration(totals?.totalSec ?? 0),
        hint: "Whole filtered range",
        icon: Clock,
        testId: "kpi-total",
      },
      {
        label: "Amount earned",
        value: fmt.money(totals?.totalAmount ?? 0),
        hint: totals?.currency ?? fmt.currency,
        icon:
          currencyIcon(totals?.currency ?? fmt.currency) ??
          CURRENCY_FALLBACK_ICON,
        testId: "kpi-amount",
      },
      {
        label: "Entries loaded",
        value: String(entries.length),
        hint: query.hasNextPage ? "More available" : "All entries in range",
        icon: ListChecks,
        testId: "kpi-entries",
      },
    ],
    [entries.length, fmt, query.hasNextPage, totals]
  );

  const isLoading = query.isPending;

  return (
    <div className="space-y-4" data-testid="detailed-report">
      <header>
        <h1 className="text-xl font-semibold">Detailed</h1>
        <p className="text-sm text-muted-foreground">
          {formatRangeLabel(state.range)}
        </p>
      </header>

      <ReportFiltersBar
        filters={filters}
        trailing={
          <ExportMenu
            report="detailed"
            filters={reportFilters}
            disabled={isLoading}
          />
        }
      />

      {isLoading ? <KpiRowSkeleton /> : <KpiRow items={kpis} />}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <TableSkeleton
              rows={8}
              columns={6}
              testId="detailed-table-skeleton"
            />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={Table2}
              title="No entries match these filters"
              description="Widen the date range, clear a filter, or track some time to populate this log."
              testId="detailed-empty"
            />
          ) : (
            <DetailedTable
              entries={entries}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              sort={sort}
              onSort={handleSort}
              duration={fmt.duration}
              money={fmt.money}
              clock={fmt.clock}
            />
          )}

          {query.hasNextPage ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
                data-testid="detailed-load-more"
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <BulkActionBar
          count={selected.size}
          pending={bulkPending}
          onClear={() => setSelected(new Set())}
          onSetProject={handleSetProject}
          onSetBillable={handleSetBillable}
          onDelete={handleDelete}
        />
      ) : null}

      {query.isError ? (
        <p className="text-sm text-destructive" data-testid="detailed-error">
          {query.error.message}
        </p>
      ) : null}
    </div>
  );
}

export default function DetailedReportPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<ReportPageSkeleton />}>
      <DetailedReport />
    </React.Suspense>
  );
}
