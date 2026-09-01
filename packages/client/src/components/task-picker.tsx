"use client";

import * as React from "react";

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
 */
export function TaskPicker({
  projectId,
  value,
  onChange,
  allowCreate = true,
  disabled = false,
  className,
  size = "default",
  testId = "task-picker",
}: TaskPickerProps): React.JSX.Element {
  const utils = trpc.useUtils();

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

  const noProject = projectId === null;

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={noProject ? "No task" : "No task"}
      searchPlaceholder="Search or create a task..."
      emptyText={noProject ? "Pick a project first." : "No tasks yet."}
      allowClear
      clearLabel="No task"
      onCreate={allowCreate && !noProject ? handleCreate : undefined}
      createLabel={(query) => `Create task "${query}"`}
      disabled={disabled || noProject || createTask.isPending}
      size={size}
      className={cn("min-w-40", className)}
      data-testid={testId}
    />
  );
}
