"use client";

import * as React from "react";

import { TaskFormDialog } from "@/components/catalog/task-form-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type TaskPickerProps = {
  value: string | null;
  onChange: (taskId: string | null) => void;
  /** Show a "Create <name>" row for unmatched searches. */
  allowCreate?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg";
  testId?: string;
};

/**
 * Task selector for the tracker bar and entry rows.
 *
 * Tasks are a flat, workspace-wide list, independent of whatever project the
 * entry is filed under — so this picker never depends on, or changes, the
 * project beside it. Creating one inline is the point: naming a task should
 * never require a detour to the Tasks screen mid-timer.
 *
 * Two create surfaces, for the same reason the project picker has two. Typing
 * a name that matches nothing offers "Create <name>" — quick, but invisible
 * until you have already typed. "New task…" sits at the bottom of the list
 * whatever the query, and opens the full dialog.
 */
export function TaskPicker({
  value,
  onChange,
  allowCreate = true,
  disabled = false,
  className,
  size = "default",
  testId = "task-picker",
}: TaskPickerProps): React.JSX.Element {
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const tasks = trpc.tasks.list.useQuery({});

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: async (task) => {
      onChange(task.id);
      toast.success(`Task "${task.name}" created`);
      await utils.tasks.invalidate();
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
      createTask.mutate({ name, originId: ORIGIN_ID });
    },
    [createTask],
  );

  const handleDialogCreated = React.useCallback(
    (task: { id: string }): void => onChange(task.id),
    [onChange],
  );

  return (
    <>
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        placeholder="No task"
        searchPlaceholder="Search or create a task..."
        emptyText="No tasks yet."
        allowClear
        clearLabel="No task"
        onCreate={allowCreate ? handleCreate : undefined}
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
        onCreated={handleDialogCreated}
      />
    </>
  );
}
