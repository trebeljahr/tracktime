"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type NumberFieldProps = {
  value: number;
  /** Called only when the parsed, clamped value actually differs. */
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  /** `step < 1` keeps two decimals; otherwise the value is rounded to an int. */
  step?: number;
  /** Rendered inside the field, e.g. "min" or a currency code. */
  suffix?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  "aria-label"?: string;
};

const parseNumber = (raw: string): number | null => {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * A numeric field that commits on blur / Enter rather than on every keypress,
 * so a half-typed "1" never gets saved as an hourly rate of one.
 */
export function NumberField({
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  suffix,
  id,
  disabled,
  className,
  testId,
  "aria-label": ariaLabel,
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = React.useState<string>(String(value));
  const [lastValue, setLastValue] = React.useState<number>(value);

  // Render-time sync: the React Compiler rules reject setState inside effects.
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = (): void => {
    const parsed = parseNumber(draft);
    if (parsed === null) {
      setDraft(String(value));
      return;
    }
    const upper = max ?? Number.MAX_SAFE_INTEGER;
    const clamped = Math.min(upper, Math.max(min, parsed));
    const next = step < 1 ? Math.round(clamped * 100) / 100 : Math.round(clamped);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
          }
        }}
        className={cn("text-right", suffix ? "pr-12" : undefined)}
        data-testid={testId}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
