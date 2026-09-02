"use client";

import * as React from "react";
import { dayKeyInZone, rollEndAfterStart, withDayInZone } from "@starter/shared";
import { deviceTimeZone } from "@starter/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DurationInput } from "@/components/duration-input";
import { ProjectPicker } from "@/components/project-picker";
import { TaskPicker } from "@/components/task-picker";
import { TagPicker } from "@/components/tags/tag-picker";
import { TimeField } from "@/components/tracker/time-field";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { useFormatSettings } from "@/lib/format";

const HOUR_MS = 3_600_000;

/** The range a freshly opened dialog offers: the hour that just passed. */
export const defaultManualRange = (): { start: string; end: string } => {
  const end = new Date();
  end.setSeconds(0, 0);
  return {
    start: new Date(end.getTime() - HOUR_MS).toISOString(),
    end: end.toISOString(),
  };
};

const clampEnd = (start: string, end: string): string =>
  Date.parse(end) > Date.parse(start)
    ? end
    : new Date(Date.parse(start) + 60_000).toISOString();

/** What the tracker bar hands over when the dialog opens. */
export type ManualEntrySeed = {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  tagIds: string[];
};

export type ManualEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill, so a half-typed composer is not thrown away by opening this. */
  seed: ManualEntrySeed;
  mutations: EntryMutations;
};

/**
 * Log a block of time that was never timed.
 *
 * This used to be a second mode of the tracker bar, reached through a `+`
 * that sat next to the timer-mode button and looked like part of the timer.
 * Logging past work is its own action, not a state the bar can be left
 * stuck in, so it gets its own button and its own modal — which also has
 * the room for a date, something the inline row never had.
 */
export function ManualEntryDialog({
  open,
  onOpenChange,
  seed,
  mutations,
}: ManualEntryDialogProps): React.JSX.Element {
  const format = useFormatSettings();
  const zone = deviceTimeZone();

  const [description, setDescription] = React.useState(seed.description);
  const [projectId, setProjectId] = React.useState(seed.projectId);
  const [taskId, setTaskId] = React.useState(seed.taskId);
  const [billable, setBillable] = React.useState(seed.billable);
  const [tagIds, setTagIds] = React.useState(seed.tagIds);
  const [range, setRange] = React.useState(defaultManualRange);

  // Reseed on each open rather than in an effect, so the very first paint
  // already shows the composer's values instead of the previous block's.
  const [wasOpen, setWasOpen] = React.useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDescription(seed.description);
      setProjectId(seed.projectId);
      setTaskId(seed.taskId);
      setBillable(seed.billable);
      setTagIds(seed.tagIds);
      setRange(defaultManualRange());
    }
  }

  const seconds = Math.max(
    0,
    Math.round((Date.parse(range.end) - Date.parse(range.start)) / 1000)
  );

  const handleProjectChange = React.useCallback(
    (nextProjectId: string | null): void => {
      // A task belongs to one project, so it cannot survive a change.
      if (nextProjectId !== projectId) setTaskId(null);
      setProjectId(nextProjectId);
    },
    [projectId]
  );

  const add = React.useCallback((): void => {
    // Roll a midnight-crossing end forward rather than clamping it: 23:30 to
    // 00:30 is an hour of work, and clamping would throw that away.
    mutations.createManualEntry({
      description,
      projectId,
      taskId,
      billable,
      tagIds,
      start: range.start,
      end: rollEndAfterStart(range.start, range.end),
    });
    onOpenChange(false);
  }, [
    billable,
    description,
    mutations,
    onOpenChange,
    projectId,
    range,
    tagIds,
    taskId,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="manual-entry-dialog">
        <DialogHeader>
          <DialogTitle>Add time entry</DialogTitle>
          <DialogDescription>
            Log a block of work that was not timed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-entry-description">Description</Label>
            <Input
              id="manual-entry-description"
              value={description}
              autoFocus
              placeholder="What did you work on?"
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              data-testid="manual-entry-description"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex-1 space-y-2">
              <Label>Project</Label>
              <ProjectPicker
                value={projectId}
                onChange={handleProjectChange}
                className="w-full"
                testId="manual-entry-project"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label>Task</Label>
              <TaskPicker
                projectId={projectId}
                value={taskId}
                onChange={setTaskId}
                className="w-full"
                testId="manual-entry-task"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagPicker
              value={tagIds}
              onChange={setTagIds}
              variant="count"
              maxChips={4}
              className="w-full"
              testId="manual-entry-tags"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="manual-entry-billable">Billable</Label>
            <Switch
              id="manual-entry-billable"
              checked={billable}
              onCheckedChange={setBillable}
              data-testid="manual-entry-billable"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-entry-date">Date</Label>
            <Input
              id="manual-entry-date"
              type="date"
              value={dayKeyInZone(Date.parse(range.start), zone)}
              onChange={(event) => {
                // Moving the date carries the end with it, so the block keeps
                // its length instead of silently stretching.
                setRange((current) => {
                  const start = withDayInZone(
                    current.start,
                    event.target.value,
                    zone
                  );
                  const delta = Date.parse(start) - Date.parse(current.start);
                  return {
                    start,
                    end: new Date(Date.parse(current.end) + delta).toISOString(),
                  };
                });
              }}
              data-testid="manual-entry-date"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Start</Label>
              <TimeField
                value={range.start}
                timeFormat={format.timeFormat}
                aria-label="Start time"
                testId="manual-entry-start"
                onCommit={(iso) =>
                  setRange((current) => ({
                    start: iso,
                    end: clampEnd(iso, current.end),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <TimeField
                value={range.end}
                timeFormat={format.timeFormat}
                aria-label="End time"
                testId="manual-entry-end"
                onCommit={(iso) =>
                  setRange((current) => ({
                    start: current.start,
                    end: clampEnd(current.start, iso),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <DurationInput
                value={seconds}
                format={format.durationFormat}
                aria-label="Duration"
                testId="manual-entry-duration"
                className="w-28"
                onCommit={(next) =>
                  setRange((current) => ({
                    start: current.start,
                    end: new Date(
                      Date.parse(current.start) + Math.max(60, next) * 1000
                    ).toISOString(),
                  }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="manual-entry-cancel"
          >
            Cancel
          </Button>
          <Button type="button" onClick={add} data-testid="manual-entry-add">
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
