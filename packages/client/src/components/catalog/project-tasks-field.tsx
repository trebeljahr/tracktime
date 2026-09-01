"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useTaskMutations } from "./use-catalog-mutations";

export type ProjectTasksFieldProps = {
  /** The project being edited, or null while it is still being created. */
  projectId: string | null;
  /**
   * Task names queued for a project that does not exist yet. The dialog creates
   * them once the project has an id.
   */
  pending: string[];
  onPendingChange: (names: string[]) => void;
};

/**
 * Tasks belong to a project, so this is where they are made.
 *
 * A time entry sits under a task, which sits under a project, which may belong
 * to a client — the whole chain should be reachable from the project you are
 * looking at, rather than sending you to another screen for each layer.
 *
 * For a project that already exists, tasks are created immediately. For one
 * being created, names are collected and written after the project is saved,
 * since a task cannot reference a project that has no id yet.
 */
export function ProjectTasksField({
  projectId,
  pending,
  onPendingChange,
}: ProjectTasksFieldProps): React.JSX.Element {
  const [draft, setDraft] = React.useState("");

  const tasks = trpc.tasks.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== null },
  );
  const { createTask, removeTask } = useTaskMutations(projectId ?? "");

  const existing = tasks.data ?? [];

  const add = React.useCallback((): void => {
    const name = draft.trim();
    if (name === "") return;

    if (projectId === null) {
      // Ignore a duplicate the user has already queued.
      if (!pending.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
        onPendingChange([...pending, name]);
      }
      setDraft("");
      return;
    }

    void createTask({ name }).then(() => setDraft(""));
  }, [createTask, draft, onPendingChange, pending, projectId]);

  return (
    <div className="space-y-2">
      <Label htmlFor="project-task-input">Tasks</Label>

      <div className="flex gap-2">
        <Input
          id="project-task-input"
          value={draft}
          placeholder="Add a task…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds a task; it must not submit the surrounding form.
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          data-testid="project-task-input"
        />
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={draft.trim() === ""}
          data-testid="project-task-add"
        >
          <Plus /> Add
        </Button>
      </div>

      {existing.length === 0 && pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tasks yet. Entries can be filed directly under the project, or
          under a task once you add one.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="project-task-list">
          {existing.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-sm"
              data-testid={`project-task-${task.id}`}
            >
              <span className="truncate">{task.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Remove ${task.name}`}
                onClick={() => removeTask(task.id)}
                data-testid={`project-task-remove-${task.id}`}
              >
                <X />
              </Button>
            </li>
          ))}

          {pending.map((name) => (
            <li
              key={`pending-${name}`}
              className="flex items-center justify-between rounded-md border border-dashed border-border px-2 py-1 text-sm text-muted-foreground"
              data-testid="project-task-pending"
            >
              <span className="truncate">{name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Remove ${name}`}
                onClick={() =>
                  onPendingChange(pending.filter((entry) => entry !== name))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
