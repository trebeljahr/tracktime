"use client";

import * as React from "react";
import { Copy, Ellipsis, Euro, Pencil, Play, Square, Trash2 } from "lucide-react";
import {
  rollEndAfterStart,
  spansLocalDayBoundary,
  type DetailedEntry,
} from "@starter/shared";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DurationInput } from "@/components/duration-input";
import { ProjectPicker } from "@/components/project-picker";
import { LiveDuration } from "@/components/tracker/live-duration";
import { TimeField } from "@/components/tracker/time-field";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { isTempId } from "@/lib/offline";
import { useFormatSettings } from "@/lib/format";
import { cn } from "@/lib/utils";

const MINUTE_MS = 60_000;

export type EntryRowProps = {
  entry: DetailedEntry;
  mutations: EntryMutations;
  onEdit: (entry: DetailedEntry) => void;
  /** Rendered inside an expanded collapse group. */
  nested?: boolean;
};

/** Billable "€" affordance — a struck-through glyph reads as "not billable". */
function BillableGlyph({ billable }: { billable: boolean }): React.JSX.Element {
  return (
    <span className="relative inline-flex items-center justify-center">
      <Euro
        className={billable ? "text-primary" : "text-muted-foreground opacity-60"}
      />
      {billable ? null : (
        <span
          aria-hidden="true"
          className="absolute h-px w-5 rotate-45 bg-muted-foreground"
        />
      )}
    </span>
  );
}

/**
 * One tracked block. Everything on the row is editable in place — description,
 * project, billable, both clock times and the duration — because the edit a
 * user actually makes is a two-minute correction, not a form submission.
 */
export function EntryRow({
  entry,
  mutations,
  onEdit,
  nested = false,
}: EntryRowProps): React.JSX.Element {
  const format = useFormatSettings();
  const running = entry.end === null;
  // A locally-invented entry has no server id yet; editing it would be lost
  // when the queued create replays.
  const syncing = isTempId(entry.id);

  const [editingDescription, setEditingDescription] = React.useState(false);
  const [draft, setDraft] = React.useState(entry.description);

  const commitDescription = React.useCallback((): void => {
    setEditingDescription(false);
    if (draft === entry.description) return;
    mutations.updateEntry({ id: entry.id, description: draft });
  }, [draft, entry.description, entry.id, mutations]);

  const handleStartCommit = React.useCallback(
    (iso: string): void => {
      if (entry.end === null) {
        mutations.updateEntry({ id: entry.id, start: iso });
        return;
      }
      // Keep the block's length when the start is dragged past the end.
      const end =
        Date.parse(iso) >= Date.parse(entry.end)
          ? new Date(
              Date.parse(iso) + Math.max(MINUTE_MS, entry.durationSec * 1000)
            ).toISOString()
          : entry.end;
      mutations.updateEntry({ id: entry.id, start: iso, end });
    },
    [entry.durationSec, entry.end, entry.id, mutations]
  );

  const handleEndCommit = React.useCallback(
    (iso: string): void => {
      // An end at or before the start means the timer ran past midnight —
      // "23:30 to 00:30" is an hour, not a minute. Roll it to the next day
      // rather than clamping, which used to silently destroy the entry.
      const end = rollEndAfterStart(entry.start, iso);
      mutations.updateEntry({ id: entry.id, end });
    },
    [entry.id, entry.start, mutations]
  );

  const handleDurationCommit = React.useCallback(
    (seconds: number): void => {
      if (running) return;
      const end = new Date(
        Date.parse(entry.start) + Math.max(60, seconds) * 1000
      ).toISOString();
      mutations.updateEntry({ id: entry.id, end });
    },
    [entry.id, entry.start, mutations, running]
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40",
        nested && "pl-10",
        running && "bg-primary/5"
      )}
      data-testid="entry-row"
      data-entry-id={entry.id}
      data-running={running ? "true" : "false"}
      data-syncing={syncing ? "true" : "false"}
    >
      {editingDescription ? (
        <Input
          value={draft}
          autoFocus
          aria-label="Description"
          className="h-8 min-w-0 flex-1 basis-56"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDescription}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDescription();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(entry.description);
              setEditingDescription(false);
            }
          }}
          data-testid="entry-description-input"
        />
      ) : (
        <button
          type="button"
          disabled={syncing}
          className={cn(
            "min-w-0 flex-1 basis-56 truncate rounded px-2 py-1 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent",
            entry.description.trim() === "" && "text-muted-foreground italic"
          )}
          onClick={() => {
            setDraft(entry.description);
            setEditingDescription(true);
          }}
          data-testid="entry-description"
        >
          {entry.description.trim() === ""
            ? "Add description"
            : entry.description}
        </button>
      )}

      <ProjectPicker
        value={entry.projectId}
        disabled={syncing}
        allowCreate={false}
        size="sm"
        className="h-8 max-w-48 border-0 shadow-none"
        placeholder="No project"
        testId="entry-project"
        onChange={(projectId) =>
          mutations.updateEntry({ id: entry.id, projectId })
        }
      />

      {entry.clientName ? (
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {entry.clientName}
        </span>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={syncing}
        aria-label={entry.billable ? "Billable" : "Not billable"}
        aria-pressed={entry.billable}
        onClick={() =>
          mutations.updateEntry({ id: entry.id, billable: !entry.billable })
        }
        data-testid="entry-billable"
        data-billable={entry.billable ? "true" : "false"}
      >
        <BillableGlyph billable={entry.billable} />
      </Button>

      <div className="flex items-center gap-1">
        <TimeField
          value={entry.start}
          timeFormat={format.timeFormat}
          disabled={syncing}
          aria-label="Start time"
          testId="entry-start"
          onCommit={handleStartCommit}
        />
        <span className="text-muted-foreground">–</span>
        {entry.end === null ? (
          <span
            className="w-[4.5rem] text-center font-mono text-sm text-muted-foreground tabular-nums"
            data-testid="entry-end"
          >
            now
          </span>
        ) : (
          <TimeField
            value={entry.end}
            timeFormat={format.timeFormat}
            disabled={syncing}
            aria-label="End time"
            testId="entry-end"
            onCommit={handleEndCommit}
          />
        )}
        {/* Without this an entry reads "23:30 – 00:30" and looks like it ran
            backwards, with nothing to say the end is on the next day. */}
        {spansLocalDayBoundary(entry.start, entry.end) ? (
          <span
            className="ml-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
            title="Ends on the next day"
            data-testid="entry-next-day"
          >
            +1d
          </span>
        ) : null}
      </div>

      {running ? (
        <LiveDuration
          baseSec={0}
          matchEntryId={entry.id}
          className="w-24 text-right text-sm"
          testId="entry-duration"
        />
      ) : (
        <DurationInput
          value={entry.durationSec}
          format={format.durationFormat}
          disabled={syncing}
          aria-label="Duration"
          testId="entry-duration"
          className="h-8 w-24"
          onCommit={handleDurationCommit}
        />
      )}

      <span
        className="hidden w-20 text-right text-sm text-muted-foreground tabular-nums sm:inline"
        data-testid="entry-amount"
      >
        {entry.hourlyRate === null ? "" : format.money(entry.amount)}
      </span>

      {/* The running entry gets Stop, not Continue. "Continuing" something
          already running stops it and starts an identical copy, which silently
          shreds one stretch of work into a pile of few-second fragments. */}
      {running ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          aria-label="Stop this entry"
          onClick={() => mutations.stopTimer()}
          data-testid="entry-stop"
        >
          <Square />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-primary"
          aria-label="Continue this entry"
          onClick={() => mutations.continueEntry(entry)}
          data-testid="entry-continue"
        >
          <Play />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Entry actions"
            data-testid="entry-menu"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => mutations.duplicateEntry(entry)}
            data-testid="entry-menu-duplicate"
          >
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={syncing}
            onSelect={() => onEdit(entry)}
            data-testid="entry-menu-edit"
          >
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => mutations.removeEntry(entry)}
            data-testid="entry-menu-delete"
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
