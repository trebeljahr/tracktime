"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { parseTimeOfDay, type DetailedEntry } from "@starter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverContent } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ProjectPicker } from "@/components/project-picker";
import { toast } from "@/components/ui/sonner";
import { useFormatSettings } from "@/lib/format";
import type { CalendarActions } from "./use-calendar-entries";

export type EntryEditPopoverProps = {
  entry: DetailedEntry;
  actions: CalendarActions;
  /** Live end used for the running entry, which has `end === null`. */
  nowMs: number;
  onClose: () => void;
};

/**
 * The inline editor opened by clicking a block. Every field commits on its
 * own (blur / Enter / toggle) so the popover needs no save button.
 */
export function EntryEditPopover({
  entry,
  actions,
  nowMs,
  onClose,
}: EntryEditPopoverProps): React.JSX.Element {
  const format = useFormatSettings();
  const isRunning = entry.end === null;
  const endIso = entry.end ?? new Date(nowMs).toISOString();

  const [description, setDescription] = React.useState(entry.description);
  const [start, setStart] = React.useState(() => format.clock(entry.start));
  const [end, setEnd] = React.useState(() => format.clock(endIso));

  // Adopt sync/drag updates that land while the popover is open.
  const [lastEntry, setLastEntry] = React.useState(entry);
  if (lastEntry !== entry) {
    setLastEntry(entry);
    setDescription(entry.description);
    setStart(format.clock(entry.start));
    setEnd(format.clock(endIso));
  }

  const durationSec = format.entryDuration(entry, nowMs);

  const commitDescription = (): void => {
    if (description === entry.description) return;
    actions.update(entry.id, { description });
  };

  const commitTime = (field: "start" | "end", raw: string): void => {
    const anchor = field === "start" ? entry.start : endIso;
    const iso = parseTimeOfDay(raw, anchor);
    if (iso === null) {
      toast.error(`"${raw}" is not a time we understand`);
      if (field === "start") setStart(format.clock(entry.start));
      else setEnd(format.clock(endIso));
      return;
    }

    const nextStart = field === "start" ? iso : entry.start;
    const nextEnd = field === "end" ? iso : endIso;
    if (Date.parse(nextEnd) <= Date.parse(nextStart)) {
      toast.error("End must be after start");
      if (field === "start") setStart(format.clock(entry.start));
      else setEnd(format.clock(endIso));
      return;
    }

    if (field === "start") {
      if (iso === entry.start) return;
      actions.update(entry.id, { start: iso });
      return;
    }
    if (isRunning) {
      // Stopping a running entry from the calendar is an explicit edit.
      actions.update(entry.id, { end: iso });
      return;
    }
    if (iso === entry.end) return;
    actions.update(entry.id, { end: iso });
  };

  return (
    <PopoverContent
      align="start"
      side="right"
      sideOffset={8}
      className="w-80 space-y-3"
      data-testid="calendar-edit-popover"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`calendar-edit-description-${entry.id}`}>
          Description
        </Label>
        <Input
          id={`calendar-edit-description-${entry.id}`}
          data-testid="calendar-edit-description"
          value={description}
          placeholder="What are you working on?"
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          onBlur={commitDescription}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDescription();
            }
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Project</Label>
        <ProjectPicker
          value={entry.projectId}
          onChange={(projectId) => {
            actions.update(entry.id, { projectId });
          }}
          className="w-full"
          testId="calendar-edit-project"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`calendar-edit-start-${entry.id}`}>Start</Label>
          <Input
            id={`calendar-edit-start-${entry.id}`}
            data-testid="calendar-edit-start"
            value={start}
            className="tabular-nums"
            onChange={(event) => {
              setStart(event.target.value);
            }}
            onBlur={() => {
              commitTime("start", start);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTime("start", start);
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`calendar-edit-end-${entry.id}`}>
            {isRunning ? "End (stops timer)" : "End"}
          </Label>
          <Input
            id={`calendar-edit-end-${entry.id}`}
            data-testid="calendar-edit-end"
            value={end}
            className="tabular-nums"
            onChange={(event) => {
              setEnd(event.target.value);
            }}
            onBlur={() => {
              commitTime("end", end);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTime("end", end);
              }
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            id={`calendar-edit-billable-${entry.id}`}
            data-testid="calendar-edit-billable"
            checked={entry.billable}
            onCheckedChange={(billable) => {
              actions.update(entry.id, { billable });
            }}
          />
          <Label htmlFor={`calendar-edit-billable-${entry.id}`}>Billable</Label>
        </div>
        <span
          className="text-muted-foreground text-sm tabular-nums"
          data-testid="calendar-edit-duration"
        >
          {format.duration(durationSec)}
        </span>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          data-testid="calendar-edit-delete"
          onClick={() => {
            actions.remove(entry.id);
            onClose();
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="calendar-edit-close"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </PopoverContent>
  );
}
