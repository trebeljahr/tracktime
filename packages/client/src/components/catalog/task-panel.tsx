"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useFormatSettings } from "@/lib/format";
import { ConfirmDialog } from "./confirm-dialog";
import { taskListInput, type TaskRow } from "./types";
import { useTaskMutations } from "./use-catalog-mutations";

export type TaskPanelProps = {
  projectId: string;
  projectName: string;
  /** Mirrors the screen-level "show archived" switch. */
  showArchived: boolean;
};

/**
 * The expanded body of a project row: add, rename, complete, archive and
 * delete tasks, each with its own tracked total.
 */
export function TaskPanel({
  projectId,
  projectName,
  showArchived,
}: TaskPanelProps): React.JSX.Element {
  const format = useFormatSettings();
  const query = trpc.tasks.list.useQuery(taskListInput(projectId), {
    staleTime: 30_000,
  });

  const [draft, setDraft] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<TaskRow | null>(null);

  const adder = useTaskMutations(projectId, { onConflict: setAddError });
  const rows = useTaskMutations(projectId, { onConflict: setRenameError });

  const tasks = React.useMemo(() => {
    const all = query.data ?? [];
    return showArchived ? all : all.filter((task) => !task.archived);
  }, [query.data, showArchived]);

  const handleAdd = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setAddError(null);
    const name = draft.trim();
    if (name === "") {
      setAddError("Name is required");
      return;
    }
    void adder.createTask({ name }).then((created) => {
      if (created) setDraft("");
    });
  };

  const commitRename = (task: TaskRow): void => {
    const name = editingName.trim();
    setEditingId(null);
    if (name === "" || name === task.name) return;
    setRenameError(null);
    void rows.updateTask({ id: task.id, name });
  };

  return (
    <div
      className="space-y-3 border-l-2 border-border bg-muted/30 px-4 py-3"
      data-testid={`task-panel-${projectId}`}
    >
      <form onSubmit={handleAdd} className="flex items-start gap-2">
        <div className="flex-1 space-y-1">
          <Input
            value={draft}
            maxLength={200}
            placeholder={`Add a task to ${projectName}`}
            aria-label="New task name"
            aria-invalid={addError !== null}
            onChange={(event) => {
              setDraft(event.target.value);
              if (addError) setAddError(null);
            }}
            data-testid={`task-new-input-${projectId}`}
          />
          {addError ? (
            <p
              className="text-sm text-destructive"
              data-testid={`task-new-error-${projectId}`}
            >
              {addError}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={adder.isSaving}
          data-testid={`task-add-${projectId}`}
        >
          <Plus className="size-4" />
          Add task
        </Button>
      </form>

      {renameError ? (
        <p
          className="text-sm text-destructive"
          data-testid={`task-rename-error-${projectId}`}
        >
          {renameError}
        </p>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : tasks.length === 0 ? (
        <p
          className="py-2 text-sm text-muted-foreground"
          data-testid={`tasks-empty-${projectId}`}
        >
          No tasks yet. Tasks are optional — time can be tracked straight on the
          project.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-background">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 px-3 py-2"
              data-testid={`task-row-${task.id}`}
            >
              <Checkbox
                checked={task.done}
                aria-label={`Mark ${task.name} done`}
                onCheckedChange={(checked) => {
                  setRenameError(null);
                  void rows.updateTask({ id: task.id, done: checked === true });
                }}
                data-testid={`task-done-${task.id}`}
              />

              {editingId === task.id ? (
                <Input
                  autoFocus
                  value={editingName}
                  maxLength={200}
                  aria-label={`Rename ${task.name}`}
                  className="h-8 flex-1"
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={() => commitRename(task)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename(task);
                    }
                    if (event.key === "Escape") setEditingId(null);
                  }}
                  data-testid={`task-rename-input-${task.id}`}
                />
              ) : (
                <button
                  type="button"
                  className={`flex-1 truncate text-left text-sm hover:underline ${
                    task.done ? "text-muted-foreground line-through" : ""
                  }`}
                  onClick={() => {
                    setRenameError(null);
                    setEditingName(task.name);
                    setEditingId(task.id);
                  }}
                  data-testid={`task-name-${task.id}`}
                >
                  {task.name}
                </button>
              )}

              {task.archived ? (
                <Badge variant="outline" className="shrink-0">
                  Archived
                </Badge>
              ) : null}

              <span
                className="shrink-0 tabular-nums text-sm text-muted-foreground"
                data-testid={`task-total-${task.id}`}
              >
                {format.duration(task.totalSec)}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={task.archived ? "Unarchive task" : "Archive task"}
                onClick={() => rows.setTaskArchived(task.id, !task.archived)}
                data-testid={`task-archive-${task.id}`}
              >
                {task.archived ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Delete task"
                className="text-destructive"
                onClick={() => setPendingDelete(task)}
                data-testid={`task-delete-${task.id}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description="If time has been tracked against this task it is archived instead of deleted, so your reports stay intact."
        confirmLabel="Delete task"
        onConfirm={() => {
          if (pendingDelete) rows.removeTask(pendingDelete.id);
          setPendingDelete(null);
        }}
        testId={`confirm-task-delete-${projectId}`}
      />
    </div>
  );
}
