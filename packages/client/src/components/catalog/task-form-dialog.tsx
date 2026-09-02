"use client";

import * as React from "react";

import { ProjectPicker } from "@/components/project-picker";
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
import { toast } from "@/components/ui/sonner";
import type { TaskRow } from "./types";
import { useTaskMutations } from "./use-catalog-mutations";

export type TaskFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this task. */
  task?: TaskRow | null;
  /** Preselected project for a new task. */
  defaultProjectId?: string | null;
  /**
   * Called with the newly created task. Lets a caller act on the result — the
   * tracker's task picker selects it immediately, so "New task…" leaves you
   * ready to start the timer.
   */
  onCreated?: (task: { id: string; name: string; projectId: string }) => void;
};

/**
 * The create/edit form behind every "New task…" surface. Unlike the inline
 * panel on a project row, a task created here has to name its project
 * explicitly — through the same picker the tracker bar uses, so a project (and
 * its client) missing from the list can be created without leaving the dialog.
 */
export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  defaultProjectId = null,
  onCreated,
}: TaskFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="task-dialog">
        {open ? (
          <TaskForm
            key={task?.id ?? "new"}
            task={task ?? null}
            defaultProjectId={defaultProjectId}
            onDone={(created) => {
              onOpenChange(false);
              if (created) onCreated?.(created);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type TaskFormProps = {
  task: TaskRow | null;
  defaultProjectId: string | null;
  /** Receives the created task on create; nothing on edit. */
  onDone: (created?: { id: string; name: string; projectId: string }) => void;
};

function TaskForm({
  task,
  defaultProjectId,
  onDone,
}: TaskFormProps): React.JSX.Element {
  const [name, setName] = React.useState(task?.name ?? "");
  const [projectId, setProjectId] = React.useState<string | null>(
    task?.projectId ?? defaultProjectId,
  );
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);

  // Unscoped: the form's own project field decides where the task lands.
  const { createTask, updateTask, isSaving } = useTaskMutations(null, {
    onConflict: setNameError,
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setNameError(null);
    setProjectError(null);

    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }

    if (task) {
      void updateTask({ id: task.id, name: trimmed }).then((saved) => {
        if (!saved) return;
        toast.success("Task saved.");
        onDone();
      });
      return;
    }

    if (projectId === null) {
      setProjectError("Pick the project this task belongs to");
      return;
    }

    void createTask({ name: trimmed, projectId }).then((created) => {
      if (!created) return;
      toast.success(`Task "${created.name}" created.`);
      onDone({ id: created.id, name: created.name, projectId });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>
          Tasks break a project down. Time can still be tracked straight on the
          project.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="task-name">Name</Label>
        <Input
          id="task-name"
          value={name}
          autoFocus
          maxLength={200}
          placeholder="Write the launch post"
          aria-invalid={nameError !== null}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          data-testid="task-name-input"
        />
        {nameError ? (
          <p className="text-sm text-destructive" data-testid="task-name-error">
            {nameError}
          </p>
        ) : null}
      </div>

      {task ? null : (
        <div className="space-y-2">
          <Label>Project</Label>
          <ProjectPicker
            value={projectId}
            onChange={(next) => {
              setProjectId(next);
              if (projectError) setProjectError(null);
            }}
            placeholder="Pick a project"
            className="w-full"
            testId="task-project-picker"
          />
          {projectError ? (
            <p
              className="text-sm text-destructive"
              data-testid="task-project-error"
            >
              {projectError}
            </p>
          ) : null}
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          // Wrapped: onDone takes an optional created task, and passing it
          // straight to onClick would hand it the mouse event instead.
          onClick={() => onDone()}
          data-testid="task-cancel"
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} data-testid="task-submit">
          {task ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </form>
  );
}
