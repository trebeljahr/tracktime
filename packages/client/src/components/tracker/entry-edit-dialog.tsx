"use client";

import * as React from "react";
import {
  dayKeyInZone,
  isSameZone,
  rollEndAfterStart,
  withDayInZone,
  zoneLabel,
  type DetailedEntry,
} from "@starter/shared";
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
import { TimeField } from "@/components/tracker/time-field";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { useFormatSettings } from "@/lib/format";

const MINUTE_MS = 60_000;

// Re-anchoring a date must happen in the ENTRY's zone, not the editor's:
// moving "23:30 Berlin" to another day should keep it at 23:30 Berlin.
// `withDayInZone` in @starter/shared does exactly that.

export type EntryEditDialogProps = {
  /** The entry being edited; `null` closes the dialog. */
  entry: DetailedEntry | null;
  onClose: () => void;
  mutations: EntryMutations;
};

/**
 * Full editor for one entry — the escape hatch for the changes the inline
 * fields cannot express, mainly moving a block to another day.
 */
export function EntryEditDialog({
  entry,
  onClose,
  mutations,
}: EntryEditDialogProps): React.JSX.Element {
  const format = useFormatSettings();

  const [description, setDescription] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [billable, setBillable] = React.useState(false);
  const [start, setStart] = React.useState<string>(() =>
    new Date().toISOString()
  );
  const [end, setEnd] = React.useState<string>(() => new Date().toISOString());

  // Everything in this dialog is read and written in the zone the entry was
  // RECORDED in, so opening it from elsewhere shows the original wall-clock
  // time and saving it unchanged does not move the entry.
  const entryZone = entry?.timeZone ?? deviceTimeZone();
  const foreignZone =
    entry !== null &&
    !isSameZone(entryZone, deviceTimeZone(), Date.parse(entry.start));

  // Reseed whenever a different entry is opened.
  const entryId = entry?.id ?? null;
  const [lastEntryId, setLastEntryId] = React.useState<string | null>(null);
  if (lastEntryId !== entryId) {
    setLastEntryId(entryId);
    if (entry !== null) {
      setDescription(entry.description);
      setProjectId(entry.projectId);
      setBillable(entry.billable);
      setStart(entry.start);
      setEnd(entry.end ?? new Date().toISOString());
    }
  }

  const seconds = Math.max(
    0,
    Math.round((Date.parse(end) - Date.parse(start)) / 1000)
  );

  const save = React.useCallback((): void => {
    if (entry === null) return;
    // Roll a midnight-crossing end forward rather than clamping it: an entry
    // from 23:30 to 00:30 is an hour of work, and clamping threw that away.
    const safeEnd = rollEndAfterStart(start, end);

    mutations.updateEntry({
      id: entry.id,
      description,
      projectId,
      billable,
      start,
      // A running entry keeps running unless it already had an end.
      end: entry.end === null ? null : safeEnd,
    });
    onClose();
  }, [billable, description, end, entry, mutations, onClose, projectId, start]);

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="entry-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
          <DialogDescription>
            Change what was tracked, where it was tracked, and when.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entry-edit-description">Description</Label>
            <Input
              id="entry-edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What did you work on?"
              data-testid="entry-edit-description"
            />
          </div>

          <div className="space-y-2">
            <Label>Project</Label>
            <ProjectPicker
              value={projectId}
              onChange={setProjectId}
              className="w-full"
              testId="entry-edit-project"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="entry-edit-billable">Billable</Label>
            <Switch
              id="entry-edit-billable"
              checked={billable}
              onCheckedChange={setBillable}
              data-testid="entry-edit-billable"
            />
          </div>

          {foreignZone ? (
            <p
              className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              data-testid="entry-edit-zone-note"
            >
              Recorded in {zoneLabel(entryZone)} ({entryZone}). Times below are
              shown and saved in that zone, so they stay as they were written.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="entry-edit-date">Start date</Label>
              <Input
                id="entry-edit-date"
                type="date"
                value={dayKeyInZone(Date.parse(start), entryZone)}
                onChange={(event) => {
                  // Moving the start date carries the end with it, so the
                  // entry keeps its length instead of silently stretching.
                  const nextStart = withDayInZone(start, event.target.value, entryZone);
                  const delta = Date.parse(nextStart) - Date.parse(start);
                  setStart(nextStart);
                  setEnd(new Date(Date.parse(end) + delta).toISOString());
                }}
                data-testid="entry-edit-date"
              />
            </div>

            {/* An entry that ran past midnight ends on a different day, and
                there was no way to see or set that. */}
            <div className="flex-1 space-y-2">
              <Label htmlFor="entry-edit-end-date">End date</Label>
              <Input
                id="entry-edit-end-date"
                type="date"
                value={dayKeyInZone(Date.parse(end), entryZone)}
                min={dayKeyInZone(Date.parse(start), entryZone)}
                onChange={(event) =>
                  setEnd(withDayInZone(end, event.target.value, entryZone))
                }
                data-testid="entry-edit-end-date"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Start</Label>
              <TimeField
                value={start}
                timeFormat={format.timeFormat}
                timeZone={entryZone}
                aria-label="Start time"
                testId="entry-edit-start"
                onCommit={setStart}
              />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <TimeField
                value={end}
                timeFormat={format.timeFormat}
                timeZone={entryZone}
                disabled={entry?.end === null}
                aria-label="End time"
                testId="entry-edit-end"
                onCommit={setEnd}
              />
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <DurationInput
                value={seconds}
                format={format.durationFormat}
                disabled={entry?.end === null}
                aria-label="Duration"
                testId="entry-edit-duration"
                onCommit={(next) =>
                  setEnd(
                    new Date(
                      Date.parse(start) + Math.max(60, next) * 1000
                    ).toISOString()
                  )
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="entry-edit-cancel"
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} data-testid="entry-edit-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
