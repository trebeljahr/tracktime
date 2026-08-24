"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format as formatDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRangeLabel, toDateKey } from "@/components/date-range-picker";
import { useFormatSettings } from "@/lib/format";
import {
  DEFAULT_VISIBLE_RANGE,
  type VisibleRange,
} from "./calendar-math";
import { EntryCreateDialog, type CreateDraft } from "./entry-create-dialog";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import {
  useCalendarActions,
  useCalendarEntries,
  type CalendarQueryInput,
} from "./use-calendar-entries";

type CalendarView = "week" | "month";

/** Selectable day windows for the week grid. */
const VISIBLE_RANGE_OPTIONS: {
  id: string;
  label: string;
  range: VisibleRange;
}[] = [
  { id: "work", label: "6:00 – 22:00", range: DEFAULT_VISIBLE_RANGE },
  { id: "core", label: "8:00 – 20:00", range: { startMin: 480, endMin: 1200 } },
  { id: "early", label: "5:00 – 14:00", range: { startMin: 300, endMin: 840 } },
  { id: "full", label: "0:00 – 24:00", range: { startMin: 0, endMin: 1440 } },
];

const RANGE_STORAGE_KEY = "tracktime.calendar.range";

const readStoredRangeId = (): string => {
  if (typeof window === "undefined") return "work";
  const stored = window.localStorage.getItem(RANGE_STORAGE_KEY);
  const match = VISIBLE_RANGE_OPTIONS.find((option) => option.id === stored);
  return match ? match.id : "work";
};

/** `?date=` is the source of truth so every view is linkable. */
const parseDateParam = (raw: string | null): Date => {
  if (raw === null) return startOfDay(new Date());
  const parsed = parseISO(raw.length > 10 ? raw.slice(0, 10) : raw);
  return Number.isNaN(parsed.getTime()) ? startOfDay(new Date()) : parsed;
};

/** Entries are fetched for whole days so blocks are never half-loaded. */
const ENTRY_LIMIT = 500;

export function CalendarScreen(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { weekStartsOn } = useFormatSettings();

  const view: CalendarView =
    searchParams.get("view") === "month" ? "month" : "week";
  const anchor = parseDateParam(searchParams.get("date"));
  const anchorMs = startOfDay(anchor).getTime();

  const [rangeId, setRangeId] = React.useState<string>(readStoredRangeId);
  const [draft, setDraft] = React.useState<CreateDraft | null>(null);

  const preferredRange =
    VISIBLE_RANGE_OPTIONS.find((option) => option.id === rangeId)?.range ??
    DEFAULT_VISIBLE_RANGE;

  const navigate = React.useCallback(
    (next: { view?: CalendarView; date?: Date }): void => {
      const params = new URLSearchParams();
      params.set("view", next.view ?? view);
      params.set(
        "date",
        toDateKey(next.date ?? new Date(anchorMs))
      );
      router.replace(`/calendar?${params.toString()}`, { scroll: false });
    },
    [anchorMs, router, view]
  );

  const weekStart = React.useMemo(
    () => startOfWeek(new Date(anchorMs), { weekStartsOn }),
    [anchorMs, weekStartsOn]
  );

  // The fetch window covers whole weeks so month cells are complete too.
  const fetchWindow = React.useMemo(() => {
    if (view === "week") {
      return { from: weekStart, to: addDays(weekStart, 7) };
    }
    const month = new Date(anchorMs);
    return {
      from: startOfWeek(startOfMonth(month), { weekStartsOn }),
      to: addDays(endOfWeek(endOfMonth(month), { weekStartsOn }), 1),
    };
  }, [anchorMs, view, weekStart, weekStartsOn]);

  const listInput = React.useMemo<CalendarQueryInput>(
    () => ({
      from: fetchWindow.from.toISOString(),
      to: fetchWindow.to.toISOString(),
      limit: ENTRY_LIMIT,
    }),
    [fetchWindow]
  );

  const { entries, isLoading } = useCalendarEntries(listInput);
  const actions = useCalendarActions(listInput);

  const title =
    view === "week"
      ? formatRangeLabel({
          from: toDateKey(weekStart),
          to: toDateKey(addDays(weekStart, 6)),
        })
      : formatDate(new Date(anchorMs), "MMMM yyyy");

  const step = (direction: -1 | 1): void => {
    const next =
      view === "week"
        ? addDays(new Date(anchorMs), direction * 7)
        : addMonths(new Date(anchorMs), direction);
    navigate({ date: next });
  };

  const openBlankDraft = (): void => {
    const base = new Date(anchorMs);
    const start = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      9,
      0,
      0,
      0
    );
    const end = new Date(start.getTime() + 60 * 60_000);
    setDraft({ start: start.toISOString(), end: end.toISOString() });
  };

  return (
    <div className="space-y-4" data-testid="calendar-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous"
            data-testid="calendar-prev"
            onClick={() => {
              step(-1);
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="calendar-today"
            onClick={() => {
              navigate({ date: new Date() });
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next"
            data-testid="calendar-next"
            onClick={() => {
              step(1);
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
          <h1
            className="ml-2 text-lg font-semibold"
            data-testid="calendar-title"
          >
            {title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "week" ? (
            <Select
              value={rangeId}
              onValueChange={(next) => {
                setRangeId(next);
                window.localStorage.setItem(RANGE_STORAGE_KEY, next);
              }}
            >
              <SelectTrigger
                className="w-36"
                aria-label="Visible hours"
                data-testid="calendar-range-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBLE_RANGE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    data-testid={`calendar-range-${option.id}`}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Tabs
            value={view}
            onValueChange={(next) => {
              navigate({ view: next === "month" ? "month" : "week" });
            }}
          >
            <TabsList>
              <TabsTrigger value="week" data-testid="calendar-view-week">
                Week
              </TabsTrigger>
              <TabsTrigger value="month" data-testid="calendar-view-month">
                Month
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            size="sm"
            data-testid="calendar-add-entry"
            onClick={openBlankDraft}
          >
            <Plus className="size-4" />
            Add entry
          </Button>
        </div>
      </div>

      {view === "week" ? (
        <WeekView
          weekStart={weekStart}
          entries={entries}
          isLoading={isLoading}
          actions={actions}
          preferredRange={preferredRange}
          onRequestCreate={setDraft}
        />
      ) : (
        <MonthView
          month={new Date(anchorMs)}
          entries={entries}
          isLoading={isLoading}
          weekStartsOn={weekStartsOn}
          onSelectDay={(date) => {
            navigate({ view: "week", date });
          }}
        />
      )}

      <EntryCreateDialog
        draft={draft}
        actions={actions}
        onClose={() => {
          setDraft(null);
        }}
      />
    </div>
  );
}
