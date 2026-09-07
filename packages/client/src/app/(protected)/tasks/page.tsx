"use client";

import * as React from "react";

import { CatalogScreen } from "@/components/catalog/catalog-screen";
import { TaskFormDialog } from "@/components/catalog/task-form-dialog";
import { TasksTable } from "@/components/catalog/tasks-table";
import {
  CLIENT_LIST_INPUT,
  PROJECT_LIST_INPUT,
  TASK_LIST_INPUT,
  type ClientRow,
  type ProjectRow,
  type TaskRow,
} from "@/components/catalog/types";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

const matches = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle);

export default function TasksPage(): React.JSX.Element {
  const format = useFormatSettings();

  const [search, setSearch] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const tasksQuery = trpc.tasks.list.useQuery(TASK_LIST_INPUT, {
    staleTime: 30_000,
  });
  const projectsQuery = trpc.projects.list.useQuery(PROJECT_LIST_INPUT, {
    staleTime: 30_000,
  });
  // Only for the project dialog a task row can open from its Project cell.
  const clientsQuery = trpc.clients.list.useQuery(CLIENT_LIST_INPUT, {
    staleTime: 30_000,
  });

  const allTasks = React.useMemo<TaskRow[]>(
    () => tasksQuery.data ?? [],
    [tasksQuery.data],
  );
  const allProjects = React.useMemo<ProjectRow[]>(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const allClients = React.useMemo<ClientRow[]>(
    () => clientsQuery.data ?? [],
    [clientsQuery.data],
  );

  const needle = search.trim().toLowerCase();

  const visibleTasks = React.useMemo(
    () =>
      allTasks.filter((task) => {
        if (!showArchived && task.archived) return false;
        if (projectFilter !== null && task.projectId !== projectFilter) {
          return false;
        }
        if (needle === "") return true;
        return (
          task.name.toLowerCase().includes(needle) ||
          matches(task.projectName, needle)
        );
      }),
    [allTasks, showArchived, projectFilter, needle],
  );

  const projectFilterOptions = React.useMemo<ComboboxOption[]>(
    () =>
      allProjects.map((project) => ({
        value: project.id,
        label: project.archived ? `${project.name} (archived)` : project.name,
        color: project.color,
      })),
    [allProjects],
  );

  const trackedTotal = visibleTasks.reduce(
    (sum, task) => sum + task.totalSec,
    0,
  );
  const openCount = visibleTasks.filter((task) => !task.done).length;

  return (
    <CatalogScreen
      title="Tasks"
      description="Every task across your projects. Deleting one keeps the entries booked on it — they stay on the project and lose the task."
      actionLabel="New task"
      onAction={() => setCreating(true)}
      actionTestId="new-task"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search tasks or projects"
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      filters={
        <Combobox
          options={projectFilterOptions}
          value={projectFilter}
          onChange={setProjectFilter}
          placeholder="All projects"
          searchPlaceholder="Filter by project..."
          emptyText="No projects yet."
          allowClear
          clearLabel="All projects"
          className="w-52"
          data-testid="catalog-project-filter"
        />
      }
      summary={
        <>
          {visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"} ·{" "}
          {openCount} open · {format.duration(trackedTotal)} tracked
        </>
      }
      hasError={tasksQuery.isError}
      testId="tasks-page"
    >
      <TasksTable
        tasks={visibleTasks}
        projects={allProjects}
        clients={allClients}
        isLoading={tasksQuery.isLoading}
        isFiltered={needle !== "" || projectFilter !== null}
        onCreate={() => setCreating(true)}
      />

      <TaskFormDialog
        open={creating}
        onOpenChange={setCreating}
        defaultProjectId={projectFilter}
      />
    </CatalogScreen>
  );
}
