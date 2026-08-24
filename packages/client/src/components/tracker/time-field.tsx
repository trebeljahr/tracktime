"use client";

import * as React from "react";
import { parseTimeOfDay, type TimeFormat } from "@starter/shared";

import { Input } from "@/components/ui/input";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimeFieldProps = {
  /** ISO datetime. The date part is preserved; only the clock time is edited. */
  value: string;
  onCommit: (iso: string) => void;
  timeFormat?: TimeFormat;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  testId?: string;
};

/**
 * Clock-time field anchored to the day its value already sits on.
 *
 * Accepts everything `parseTimeOfDay` does ("9:15", "0915", "9pm"). Editing is
 * local until blur or Enter so a half-typed time never fires a mutation, and
 * Escape restores the committed value.
 */
export function TimeField({
  value,
  onCommit,
  timeFormat = "24h",
  disabled = false,
  className,
  "aria-label": ariaLabel = "Time",
  testId = "time-field",
}: TimeFieldProps): React.JSX.Element {
  const display = React.useMemo(
    () => formatClock(value, timeFormat),
    [value, timeFormat]
  );

  const [draft, setDraft] = React.useState(display);
  const [editing, setEditing] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [lastDisplay, setLastDisplay] = React.useState(display);

  // Adopt sync-driven changes unless the user is mid-edit.
  if (lastDisplay !== display) {
    setLastDisplay(display);
    if (!editing) setDraft(display);
  }

  const commit = React.useCallback((): void => {
    const parsed = parseTimeOfDay(draft, value);
    if (parsed === null) {
      setInvalid(true);
      setDraft(display);
      return;
    }
    setInvalid(false);
    setDraft(formatClock(parsed, timeFormat));
    if (parsed !== value) onCommit(parsed);
  }, [draft, display, onCommit, timeFormat, value]);

  return (
    <Input
      value={draft}
      disabled={disabled}
      spellCheck={false}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={cn(
        "h-8 w-[4.5rem] px-1 text-center font-mono text-sm tabular-nums",
        className
      )}
      onFocus={(event) => {
        setEditing(true);
        setInvalid(false);
        event.target.select();
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        setEditing(false);
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setInvalid(false);
          setDraft(display);
          event.currentTarget.blur();
        }
      }}
      data-testid={testId}
    />
  );
}
