"use client";

import * as React from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { toast } from "@/components/ui/sonner";
import { ORIGIN_ID } from "@/hooks/use-sync";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/** The minimum a picker row needs — matches `projects.list` output. */
export type PickableProject = {
  id: string;
  name: string;
  color: string;
  clientName?: string | null;
};

const UNGROUPED = "No client";

/** Group by client so the list reads the way the sidebar does. */
export const toProjectOptions = (
  projects: PickableProject[]
): ComboboxOption[] =>
  projects.map((project) => ({
    value: project.id,
    label: project.name,
    color: project.color,
    group: project.clientName ?? UNGROUPED,
    keywords: [project.name, project.clientName ?? UNGROUPED],
  }));

export type ProjectPickerProps = {
  value: string | null;
  onChange: (projectId: string | null) => void;
  /** Show a "Create <name>" row for unmatched searches. */
  allowCreate?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm" | "lg";
  testId?: string;
};

/**
 * Project selector shared by the tracker bar, the entry rows and the report
 * filters. Reads the catalog straight from tRPC so it always reflects the
 * latest sync event without the caller threading data through.
 */
export function ProjectPicker({
  value,
  onChange,
  allowCreate = true,
  placeholder = "No project",
  disabled = false,
  className,
  size = "default",
  testId = "project-picker",
}: ProjectPickerProps): React.JSX.Element {
  const utils = trpc.useUtils();
  const projects = trpc.projects.list.useQuery({});

  const createProject = trpc.projects.create.useMutation({
    onSuccess: async (project) => {
      onChange(project.id);
      toast.success(`Project "${project.name}" created`);
      await utils.projects.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const options = React.useMemo(
    () => toProjectOptions(projects.data ?? []),
    [projects.data]
  );

  const handleCreate = React.useCallback(
    (name: string): void => {
      createProject.mutate({ name, originId: ORIGIN_ID });
    },
    [createProject]
  );

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search projects..."
      emptyText="No projects found."
      allowClear
      clearLabel="No project"
      onCreate={allowCreate ? handleCreate : undefined}
      createLabel={(query) => `Create project "${query}"`}
      disabled={disabled || createProject.isPending}
      size={size}
      className={cn("min-w-48", className)}
      data-testid={testId}
    />
  );
}
