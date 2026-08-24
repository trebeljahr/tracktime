"use client";

import * as React from "react";
import { parseTimeOfDay } from "@starter/shared";

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
import { ProjectPicker } from "@/components/project-picker";
import { toast } from "@/components/ui/sonner";
import { formatDayLabel, useFormatSettings } from "@/lib/format";
import type { CalendarActions } from "./use-calendar-entries";

/** The times a drag on empty space produced. */
export type CreateDraft = {
  start: string;
  end: string;
};

export type EntryCreateDialogProps = {
  draft: CreateDraft | null;
  actions: CalendarActions;
  onClose: () => void;
};

/**
 * Prefilled "new entry" dialog. Opens from a drag on empty grid space, and
 * from the toolbar's "Add entry" button.
 */
export function EntryCreateDialog({
  draft,
  actions,
  onClose,
}: EntryCreateDialogProps): React.JSX.Element {
  const format = useFormatSettings();

  const [description, setDescription] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [billable, setBillable] = React.useState(false);
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");

  // A fresh draft resets the form; editing mid-draft is never clobbered.
  const [lastDraft, setLastDraft] = React.useState<CreateDraft | null>(null);
  if (draft !== null && lastDraft !== draft) {
    setLastDraft(draft);
    setDescription("");
    setProjectId(null);
    setBillable(false);
    setStart(format.clock(draft.start));
    setEnd(format.clock(draft.end));
  }

  const submit = (): void => {
    if (!draft) return;
    const startIso = parseTimeOfDay(start, draft.start);
    const endIso = parseTimeOfDay(end, draft.start);
    if (startIso === null || endIso === null) {
      toast.error("Enter times like 9:15 or 14:00");
      return;
    }
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      toast.error("End must be after start");
      return;
    }

    actions.create({
      description,
      projectId,
      taskId: null,
      billable,
      start: startIso,
      end: endIso,
    });
    onClose();
  };

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="calendar-create-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New time entry</DialogTitle>
          <DialogDescription>
            {draft ? formatDayLabel(draft.start) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="calendar-create-description">Description</Label>
            <Input
              id="calendar-create-description"
              data-testid="calendar-create-description"
              autoFocus
              value={description}
              placeholder="What are you working on?"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Project</Label>
            <ProjectPicker
              value={projectId}
              onChange={setProjectId}
              className="w-full"
              testId="calendar-create-project"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="calendar-create-start">Start</Label>
              <Input
                id="calendar-create-start"
                data-testid="calendar-create-start"
                className="tabular-nums"
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calendar-create-end">End</Label>
              <Input
                id="calendar-create-end"
                data-testid="calendar-create-end"
                className="tabular-nums"
                value={end}
                onChange={(event) => {
                  setEnd(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="calendar-create-billable"
              data-testid="calendar-create-billable"
              checked={billable}
              onCheckedChange={setBillable}
            />
            <Label htmlFor="calendar-create-billable">Billable</Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            data-testid="calendar-create-cancel"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button data-testid="calendar-create-submit" onClick={submit}>
            Create entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
