"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import type { ProjectRow, TaskRow } from "./types";
import { useTaskMutations } from "./use-catalog-mutations";

export type TaskFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted/null creates; otherwise the dialog edits this task. */
  task?: TaskRow | null;
  projects: ProjectRow[];
  /** Preselected project for a new task. */
  defaultProjectId?: string | null;
};

/**
 * The Tasks screen's create/edit form. Unlike the inline panel on a project
 * row, a task created here has to name its project explicitly.
 */
export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  projects,
  defaultProjectId = null,
}: TaskFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="task-dialog">
        {open ? (
          <TaskForm
            key={task?.id ?? "new"}
            task={task ?? null}
            projects={projects}
            defaultProjectId={defaultProjectId}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type TaskFormProps = {
  task: TaskRow | null;
  projects: ProjectRow[];
  defaultProjectId: string | null;
  onDone: () => void;
};

function TaskForm({
  task,
  projects,
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

  const projectOptions = React.useMemo<ComboboxOption[]>(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.archived ? `${project.name} (archived)` : project.name,
        color: project.color,
        keywords: project.clientName ? [project.clientName] : [],
      })),
    [projects],
  );

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
      onDone();
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
          <Combobox
            options={projectOptions}
            value={projectId}
            onChange={(next) => {
              setProjectId(next);
              if (projectError) setProjectError(null);
            }}
            placeholder="Pick a project"
            searchPlaceholder="Search projects..."
            emptyText="No projects yet."
            className="w-full"
            data-testid="task-project-picker"
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
          onClick={onDone}
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
