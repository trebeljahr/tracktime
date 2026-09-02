"use client";

import * as React from "react";
import { AlarmClockOff } from "lucide-react";
import {
  formatDurationShort,
  runawayActionSummary,
  type RunawayMark,
  type RunawayResolution,
  type TimeEntry,
} from "@starter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RunawayAnswer = {
  resolution: RunawayResolution;
  /** ISO datetime, only for the `end-at` resolution. */
  end?: string;
};

export type RunawayPromptProps = {
  entry: TimeEntry;
  mark: RunawayMark;
  onAnswer: (answer: RunawayAnswer) => void;
};

/** `YYYY-MM-DDTHH:mm` in the viewer's own zone, for `<input type=datetime-local>`. */
const toLocalInputValue = (iso: string): string => {
  const at = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(
    at.getHours(),
  )}:${pad(at.getMinutes())}`;
};

/**
 * The runaway-timer prompt, rendered inside a sonner toast.
 *
 * Third of a family, and deliberately the same shape as the other two: the
 * sub-minute "Discard" offer and the idle prompt. All three say the same thing
 * — something looks wrong with this entry, here is what we would do, nothing
 * happens until you pick.
 *
 * The wording leads with how long it ran rather than with what was cut,
 * because the honest first question is whether it ran that long on purpose.
 * "Put it back" is always present when a cap has already happened; there is no
 * state this prompt can be in where the original span is unreachable.
 */
export function RunawayPrompt({
  entry,
  mark,
  onAnswer,
}: RunawayPromptProps): React.JSX.Element {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() =>
    toLocalInputValue(
      new Date(
        Date.parse(entry.start) + mark.limitSec * 1000,
      ).toISOString(),
    ),
  );

  const ran = formatDurationShort(mark.elapsedSec);
  const limit = formatDurationShort(mark.limitSec);
  const capped = mark.action === "capped";
  const stillRunning = entry.end === null;

  const submitEndAt = (): void => {
    const parsed = Date.parse(draft);
    if (Number.isNaN(parsed)) return;
    onAnswer({ resolution: "end-at", end: new Date(parsed).toISOString() });
  };

  return (
    <div
      className="flex w-full flex-col gap-3 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg"
      data-testid="runaway-prompt"
      data-runaway-action={mark.action}
      data-runaway-elapsed-sec={mark.elapsedSec}
    >
      <div className="flex items-start gap-3">
        <AlarmClockOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium leading-none">
            This timer ran for {ran}
          </p>
          <p className="text-sm text-muted-foreground">
            {runawayActionSummary(mark)} Your maximum is {limit}. Keep it if you
            really did work that long.
          </p>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            type="datetime-local"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Real end time"
            className="h-8 w-auto flex-1 basis-52"
            data-testid="runaway-end-at"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            data-testid="runaway-end-at-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submitEndAt}
            data-testid="runaway-end-at-save"
          >
            Save
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onAnswer({ resolution: "keep" })}
            data-testid="runaway-keep"
          >
            {capped ? "Keep the cap" : "I worked that long"}
          </Button>

          {capped ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAnswer({ resolution: "restore" })}
              data-testid="runaway-restore"
            >
              Put back {ran}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAnswer({ resolution: "cap" })}
              data-testid="runaway-cap"
            >
              {stillRunning ? `Cap at ${limit}` : `Cut back to ${limit}`}
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            onClick={() => setEditing(true)}
            data-testid="runaway-end-at-open"
          >
            Set the end…
          </Button>
        </div>
      )}
    </div>
  );
}
