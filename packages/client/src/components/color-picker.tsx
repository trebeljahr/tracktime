"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Mirrors the server's catalog palette (`CATALOG_COLOR_PALETTE`) so a colour
 * picked here is indistinguishable from one auto-assigned on create.
 */
export const COLOR_PALETTE: readonly string[] = [
  "#4f46e5",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#8b5cf6",
  "#64748b",
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** True for the `#rrggbb` form the API accepts. */
export const isHexColor = (value: string): boolean => HEX.test(value);

const normalize = (value: string): string => {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return withHash.toLowerCase();
};

export type ColorPickerProps = {
  /** Current colour as `#rrggbb`. */
  value: string;
  onChange: (color: string) => void;
  /** Label rendered next to the swatch on the trigger. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Prefix for the trigger/swatch test ids. */
  testId?: string;
};

/** Swatch grid over the catalog palette, with a hex escape hatch. */
export function ColorPicker({
  value,
  onChange,
  label,
  disabled = false,
  className,
  testId = "color-picker",
}: ColorPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);

  // Adopt an externally changed colour during render — the documented
  // alternative to a setState-in-effect round trip.
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
  }

  const commitDraft = React.useCallback((): void => {
    const next = normalize(draft);
    if (isHexColor(next)) {
      onChange(next);
      setOpen(false);
      return;
    }
    setDraft(value);
  }, [draft, onChange, value]);

  const pick = React.useCallback(
    (color: string): void => {
      onChange(color);
      setDraft(color);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("justify-start gap-2 font-normal", className)}
          aria-label={label ?? "Pick a colour"}
          data-testid={testId}
        >
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: isHexColor(value) ? value : undefined }}
          />
          <span className="truncate">{label ?? value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-3"
        data-testid={`${testId}-content`}
      >
        <div className="grid grid-cols-6 gap-2">
          {COLOR_PALETTE.map((color) => {
            const selected = normalize(value) === color;
            return (
              <button
                key={color}
                type="button"
                onClick={() => pick(color)}
                aria-label={color}
                aria-pressed={selected}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-foreground" : "border-transparent"
                )}
                style={{ backgroundColor: color }}
                data-testid={`${testId}-swatch-${color.replace("#", "")}`}
              >
                {selected ? (
                  <Check className="size-3.5 text-white drop-shadow" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              }
              if (event.key === "Escape") setDraft(value);
            }}
            spellCheck={false}
            aria-label="Hex colour"
            placeholder="#4f46e5"
            className="h-8 font-mono text-xs"
            data-testid={`${testId}-hex`}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
