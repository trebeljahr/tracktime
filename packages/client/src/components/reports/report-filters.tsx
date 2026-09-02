"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  MultiSelect,
  type MultiSelectOption,
} from "@/components/reports/multi-select";
import { TagFilter } from "@/components/tags/tag-filter";
import {
  REPORT_PARAM,
  type BillableFilter,
  type UseReportFiltersResult,
} from "@/components/reports/use-report-filters";

const SEARCH_DEBOUNCE_MS = 350;

const BILLABLE_LABEL: Record<BillableFilter, string> = {
  all: "All entries",
  yes: "Billable",
  no: "Non-billable",
};

/** Debounced description search - one URL write per pause, not per keystroke. */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);
  const timer = React.useRef<number | null>(null);

  // Adopt external changes (back/forward, filter reset) without clobbering a
  // value the user is mid-way through typing.
  if (lastValue !== value) {
    setLastValue(value);
    if (timer.current === null) setDraft(value);
  }

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const schedule = React.useCallback(
    (next: string): void => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        onChange(next);
      }, SEARCH_DEBOUNCE_MS);
    },
    [onChange]
  );

  const flush = React.useCallback(
    (next: string): void => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      onChange(next);
    },
    [onChange]
  );

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={draft}
        placeholder="Search descriptions"
        aria-label="Search descriptions"
        className="w-full pl-8 sm:w-56"
        onChange={(event) => {
          setDraft(event.target.value);
          schedule(event.target.value);
        }}
        onBlur={() => flush(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            flush(draft);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft("");
            flush("");
          }
        }}
        data-testid="filter-search"
      />
    </div>
  );
}

export type ReportFiltersBarProps = {
  filters: UseReportFiltersResult;
  /** Weekly swaps the range picker for its own week navigation. */
  hideDateRange?: boolean;
  /** Rendered at the very start of the bar (weekly week nav). */
  leading?: React.ReactNode;
  /** Rendered at the end, right-aligned - normally `<ExportMenu />`. */
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * The filter bar every report shares. All state lives in the URL, so the three
 * routes stay in step with one another and a report link is shareable.
 */
export function ReportFiltersBar({
  filters,
  hideDateRange = false,
  leading,
  trailing,
  className,
}: ReportFiltersBarProps): React.JSX.Element {
  const {
    state,
    weekStartsOn,
    isFiltered,
    setRange,
    setIds,
    setParams,
    setBillable,
    setSearch,
    clearFilters,
  } = filters;

  const clientsQuery = trpc.clients.list.useQuery({});
  const projectsQuery = trpc.projects.list.useQuery({});

  // `tasks.list` is scoped to one project, so the task filter only makes sense
  // once at least one project is picked - and then it needs one query each.
  const taskQueries = trpc.useQueries((t) =>
    state.projectIds.map((projectId) => t.tasks.list({ projectId }))
  );

  const clientOptions = React.useMemo<MultiSelectOption[]>(
    () =>
      (clientsQuery.data ?? []).map((client) => ({
        value: client.id,
        label: client.name,
        color: client.color,
      })),
    [clientsQuery.data]
  );

  const projectOptions = React.useMemo<MultiSelectOption[]>(
    () =>
      (projectsQuery.data ?? []).map((project) => ({
        value: project.id,
        label: project.name,
        color: project.color,
        group: project.clientName ?? "No client",
      })),
    [projectsQuery.data]
  );

  const projectNames = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const project of projectsQuery.data ?? []) {
      names.set(project.id, project.name);
    }
    return names;
  }, [projectsQuery.data]);

  const taskOptions = React.useMemo<MultiSelectOption[]>(() => {
    const options: MultiSelectOption[] = [];
    taskQueries.forEach((query, index) => {
      const projectId = state.projectIds[index];
      const heading = projectId ? projectNames.get(projectId) : undefined;
      for (const task of query.data ?? []) {
        options.push({
          value: task.id,
          label: task.name,
          group: heading ?? "Tasks",
        });
      }
    });
    return options;
  }, [projectNames, state.projectIds, taskQueries]);

  const hasProjectSelection = state.projectIds.length > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2",
        className
      )}
      data-testid="report-filters"
    >
      {leading}

      {hideDateRange ? null : (
        <DateRangePicker
          value={state.range}
          onChange={setRange}
          weekStartsOn={weekStartsOn}
          testId="filter-range"
        />
      )}

      <MultiSelect
        label="Clients"
        options={clientOptions}
        value={state.clientIds}
        onChange={(ids) => setIds("clientIds", ids)}
        emptyText="No clients yet."
        searchPlaceholder="Search clients..."
        className="w-[9.5rem]"
        testId="filter-clients"
      />

      <MultiSelect
        label="Projects"
        options={projectOptions}
        value={state.projectIds}
        onChange={(ids) => {
          // Written in one go: two `router.replace` calls in the same tick
          // would both be computed from the pre-change query string, and the
          // second would silently drop the first.
          setParams({
            [REPORT_PARAM.projects]: ids.length > 0 ? ids.join(",") : null,
            // Tasks belong to projects - a task filter for a project that is
            // no longer selected would silently match nothing.
            [REPORT_PARAM.tasks]: null,
          });
        }}
        emptyText="No projects yet."
        searchPlaceholder="Search projects..."
        className="w-[9.5rem]"
        testId="filter-projects"
      />

      <MultiSelect
        label={hasProjectSelection ? "Tasks" : "Tasks (pick a project)"}
        options={taskOptions}
        value={state.taskIds}
        onChange={(ids) => setIds("taskIds", ids)}
        disabled={!hasProjectSelection}
        emptyText="No tasks in the selected projects."
        searchPlaceholder="Search tasks..."
        className={cn(hasProjectSelection ? "w-[9.5rem]" : "w-[11.5rem]")}
        testId="filter-tasks"
      />

      <TagFilter
        value={state.tagIds}
        onChange={(ids) => setIds("tagIds", ids)}
      />

      <Select
        value={state.billable}
        onValueChange={(next) => setBillable(next as BillableFilter)}
      >
        <SelectTrigger className="w-[9.5rem]" data-testid="filter-billable">
          <SelectValue>{BILLABLE_LABEL[state.billable]}</SelectValue>
        </SelectTrigger>
        <SelectContent data-testid="filter-billable-content">
          <SelectItem value="all" data-testid="filter-billable-all">
            All entries
          </SelectItem>
          <SelectItem value="yes" data-testid="filter-billable-yes">
            Billable
          </SelectItem>
          <SelectItem value="no" data-testid="filter-billable-no">
            Non-billable
          </SelectItem>
        </SelectContent>
      </Select>

      <SearchField value={state.search} onChange={setSearch} />

      {isFiltered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          data-testid="filter-clear"
        >
          <X className="size-4" />
          Clear
        </Button>
      ) : null}

      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
