"use client";

import * as React from "react";
import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { CalendarDays } from "lucide-react";
import type { WeekStart } from "@starter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Inclusive range of local calendar dates, both "YYYY-MM-DD". */
export type DateRange = {
  from: string;
  to: string;
};

export type DateRangePresetId =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear";

export const DATE_RANGE_PRESETS: {
  id: DateRangePresetId;
  label: string;
}[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This week" },
  { id: "lastWeek", label: "Last week" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisYear", label: "This year" },
];

/** Local "YYYY-MM-DD" — never `toISOString()`, which shifts across timezones. */
export const toDateKey = (date: Date): string => format(date, "yyyy-MM-dd");

const parseDateKey = (key: string): Date | null => {
  const parsed = parseISO(key.length > 10 ? key.slice(0, 10) : key);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Resolve a preset against `now`, honouring the workspace week start. */
export const rangeForPreset = (
  preset: DateRangePresetId,
  weekStartsOn: WeekStart = 1,
  now: Date = new Date()
): DateRange => {
  const weekOptions = { weekStartsOn } as const;

  switch (preset) {
    case "today":
      return { from: toDateKey(now), to: toDateKey(now) };
    case "yesterday": {
      const day = subDays(now, 1);
      return { from: toDateKey(day), to: toDateKey(day) };
    }
    case "thisWeek":
      return {
        from: toDateKey(startOfWeek(now, weekOptions)),
        to: toDateKey(endOfWeek(now, weekOptions)),
      };
    case "lastWeek": {
      const day = subWeeks(now, 1);
      return {
        from: toDateKey(startOfWeek(day, weekOptions)),
        to: toDateKey(endOfWeek(day, weekOptions)),
      };
    }
    case "thisMonth":
      return {
        from: toDateKey(startOfMonth(now)),
        to: toDateKey(endOfMonth(now)),
      };
    case "lastMonth": {
      const day = subMonths(now, 1);
      return {
        from: toDateKey(startOfMonth(day)),
        to: toDateKey(endOfMonth(day)),
      };
    }
    case "thisYear":
      return {
        from: toDateKey(startOfYear(now)),
        to: toDateKey(endOfYear(now)),
      };
  }
};

/** The preset a range corresponds to, or null when it is a custom range. */
export const matchPreset = (
  range: DateRange,
  weekStartsOn: WeekStart = 1,
  now: Date = new Date()
): DateRangePresetId | null => {
  for (const { id } of DATE_RANGE_PRESETS) {
    const candidate = rangeForPreset(id, weekStartsOn, now);
    if (candidate.from === range.from && candidate.to === range.to) return id;
  }
  return null;
};

/** "21 Aug 2026" or "1 – 7 Aug 2026" — a compact, unambiguous label. */
export const formatRangeLabel = (range: DateRange): string => {
  const from = parseDateKey(range.from);
  const to = parseDateKey(range.to);
  if (!from || !to) return "Select dates";
  if (isSameDay(from, to)) return format(from, "d MMM yyyy");
  if (from.getFullYear() === to.getFullYear()) {
    if (from.getMonth() === to.getMonth()) {
      return `${format(from, "d")} – ${format(to, "d MMM yyyy")}`;
    }
    return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
  }
  return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
};

export type DateRangePickerProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  weekStartsOn?: WeekStart;
  className?: string;
  align?: "start" | "center" | "end";
  testId?: string;
};

/**
 * Preset-first range picker. Presets cover the ranges a time tracker asks for
 * daily; the custom fields exist for everything else.
 */
export function DateRangePicker({
  value,
  onChange,
  weekStartsOn = 1,
  className,
  align = "start",
  testId = "date-range-picker",
}: DateRangePickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  const active = React.useMemo(
    () => matchPreset(value, weekStartsOn),
    [value, weekStartsOn]
  );

  const applyPreset = React.useCallback(
    (preset: DateRangePresetId): void => {
      onChange(rangeForPreset(preset, weekStartsOn));
      setOpen(false);
    },
    [onChange, weekStartsOn]
  );

  const setBound = React.useCallback(
    (bound: "from" | "to", next: string): void => {
      if (next === "") return;
      const candidate: DateRange = { ...value, [bound]: next };
      // Keep the range ordered: an out-of-order edit collapses it to one day
      // rather than silently producing a range the server would reject.
      onChange(
        candidate.from > candidate.to ? { from: next, to: next } : candidate
      );
    },
    [onChange, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("justify-start gap-2 font-normal", className)}
          data-testid={testId}
        >
          <CalendarDays className="size-4 opacity-70" />
          <span className="truncate">
            {active
              ? (DATE_RANGE_PRESETS.find((p) => p.id === active)?.label ??
                formatRangeLabel(value))
              : formatRangeLabel(value)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-72 p-2"
        data-testid={`${testId}-content`}
      >
        <div className="grid gap-1">
          {DATE_RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant={active === preset.id ? "secondary" : "ghost"}
              size="sm"
              className="justify-start font-normal"
              onClick={() => applyPreset(preset.id)}
              data-testid={`${testId}-preset-${preset.id}`}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <Separator className="my-2" />

        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`${testId}-from`} className="text-xs">
              From
            </Label>
            <Input
              id={`${testId}-from`}
              type="date"
              value={value.from}
              onChange={(event) => setBound("from", event.target.value)}
              className="h-8"
              data-testid={`${testId}-from`}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${testId}-to`} className="text-xs">
              To
            </Label>
            <Input
              id={`${testId}-to`}
              type="date"
              value={value.to}
              onChange={(event) => setBound("to", event.target.value)}
              className="h-8"
              data-testid={`${testId}-to`}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
