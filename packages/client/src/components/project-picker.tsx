"use client";

import * as React from "react";

import { ProjectFormDialog } from "@/components/catalog/project-form-dialog";
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

/**
 * Split a create query written as "Client / Project".
 *
 * Lets a whole client-and-project pair be created from the dropdown itself,
 * without a detour to the Projects screen. A query with no separator (or an
 * empty half) is just a project name.
 */
export const splitClientAndProject = (
  query: string
): { clientName: string | null; projectName: string } => {
  const separator = query.indexOf("/");
  if (separator === -1) return { clientName: null, projectName: query.trim() };

  const clientName = query.slice(0, separator).trim();
  const projectName = query.slice(separator + 1).trim();

  if (clientName === "" || projectName === "") {
    return { clientName: null, projectName: query.replace("/", " ").trim() };
  }
  return { clientName, projectName };
};

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
  const clients = trpc.clients.list.useQuery({});

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

  const createClient = trpc.clients.create.useMutation({
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Explicit create surfaces. The "Client / Project" shorthand is quick once
  // you know it, but it only appears after typing a name that matches nothing —
  // so on an empty workspace there was no visible way to make a project at all.
  // Only "New project…" lives here. A client is a property OF a project, so it
  // is created inside the project dialog rather than as a sibling action in a
  // picker that is about choosing a project.
  const [projectDialogOpen, setProjectDialogOpen] = React.useState(false);

  const options = React.useMemo(
    () => toProjectOptions(projects.data ?? []),
    [projects.data]
  );

  /**
   * Create a project, and its client too when the query is written as
   * "Client / Project". An existing client of that name is reused rather than
   * duplicated (the server rejects duplicate names anyway), so typing the same
   * client repeatedly keeps filing projects under the one client.
   */
  const handleCreate = React.useCallback(
    (query: string): void => {
      const { clientName, projectName } = splitClientAndProject(query);

      if (clientName === null) {
        createProject.mutate({ name: projectName, originId: ORIGIN_ID });
        return;
      }

      const existing = (clients.data ?? []).find(
        (client) => client.name.toLowerCase() === clientName.toLowerCase()
      );

      if (existing) {
        createProject.mutate({
          name: projectName,
          clientId: existing.id,
          originId: ORIGIN_ID,
        });
        return;
      }

      createClient.mutate(
        { name: clientName, originId: ORIGIN_ID },
        {
          onSuccess: async (client) => {
            await utils.clients.invalidate();
            createProject.mutate({
              name: projectName,
              clientId: client.id,
              originId: ORIGIN_ID,
            });
          },
        }
      );
    },
    [clients.data, createClient, createProject, utils]
  );

  return (
    <>
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
        createLabel={(query) => {
          const { clientName, projectName } = splitClientAndProject(query);
          return clientName
            ? `Create project "${projectName}" for client "${clientName}"`
            : `Create project "${projectName}"`;
        }}
        createHint={'Tip: type "Client / Project" to create both at once'}
        disabled={disabled || createProject.isPending || createClient.isPending}
        size={size}
        className={cn("min-w-48", className)}
        data-testid={testId}
        footerActions={
          allowCreate
            ? [
                {
                  label: "New project…",
                  onSelect: () => setProjectDialogOpen(true),
                  testId: "project-picker-new-project",
                },
              ]
            : undefined
        }
      />

      <ProjectFormDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        clients={clients.data ?? []}
        onCreated={(project) => onChange(project.id)}
      />
    </>
  );
}
