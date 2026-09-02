"use client";

import * as React from "react";

import { TaskFormDialog } from "@/components/catalog/task-form-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type TaskPickerProps = {
  /** Tasks belong to a project; with none selected there is nothing to pick. */
  projectId: string | null;
  value: string | null;
  onChange: (taskId: string | null) => void;
  /**
   * Called when a task created from here belongs to a different project than
   * the one currently selected — the caller has to follow, or the row would
   * end up filed under a project its task does not belong to.
   */
  onProjectChange?: (projectId: string) => void;
  /** Show a "Create <name>" row for unmatched searches. */
  allowCreate?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg";
  testId?: string;
};

/**
 * Task selector for the tracker bar and entry rows. Creating a task inline is
 * the point: picking a project and naming a task should never require a detour
 * to the Projects screen mid-timer.
 *
 * Two create surfaces, for the same reason the project picker has two. Typing
 * a name that matches nothing offers "Create <name>" — quick, but invisible
 * until you have already typed. "New task…" sits at the bottom of the list
 * whatever the query, and opens the full dialog, which carries a project
 * picker of its own. That dialog is why this picker stays open with no project
 * selected: a task always needs one, but "pick a project first" is an answer
 * the dialog can give, not a reason to make the control dead.
 */
export function TaskPicker({
  projectId,
  value,
  onChange,
  onProjectChange,
  allowCreate = true,
  disabled = false,
  className,
  size = "default",
  testId = "task-picker",
}: TaskPickerProps): React.JSX.Element {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const tasks = trpc.tasks.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: projectId !== null },
  );

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: async (task) => {
      onChange(task.id);
      toast.success(`Task "${task.name}" created`);
      await utils.tasks.invalidate();
      await utils.projects.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const options = React.useMemo<ComboboxOption[]>(
    () =>
      (tasks.data ?? []).map((task) => ({
        value: task.id,
        label: task.name,
        keywords: [task.name],
      })),
    [tasks.data],
  );

  const handleCreate = React.useCallback(
    (name: string): void => {
      if (projectId === null) return;
      createTask.mutate({ projectId, name, originId: ORIGIN_ID });
    },
    [createTask, projectId],
  );

  // The dialog can file the task anywhere, including under a project it just
  // created. Selecting the task without moving the caller to that project
  // would leave the two disagreeing, so the project moves first.
  const handleDialogCreated = React.useCallback(
    (task: { id: string; projectId: string }): void => {
      if (task.projectId !== projectId) onProjectChange?.(task.projectId);
      onChange(task.id);
    },
    [onChange, onProjectChange, projectId],
  );

  const noProject = projectId === null;

  return (
    <>
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder="No task"
        searchPlaceholder={
          noProject ? "Pick a project, or add a task…" : "Search or create a task..."
        }
        emptyText={
          noProject ? "Pick a project first, or add a task below." : "No tasks yet."
        }
        allowClear
        clearLabel="No task"
        onCreate={allowCreate && !noProject ? handleCreate : undefined}
        createLabel={(query) => `Create task "${query}"`}
        disabled={disabled || createTask.isPending}
        size={size}
        className={cn("min-w-40", className)}
        data-testid={testId}
        footerActions={
          allowCreate
            ? [
                {
                  label: "New task…",
                  onSelect: () => setDialogOpen(true),
                  testId: "task-picker-new-task",
                },
              ]
            : undefined
        }
      />

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultProjectId={projectId}
        onCreated={handleDialogCreated}
      />
    </>
  );
}
