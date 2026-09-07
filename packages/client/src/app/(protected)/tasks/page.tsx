"use client";

import * as React from "react";

import { CatalogScreen } from "@/components/catalog/catalog-screen";
import { TaskFormDialog } from "@/components/catalog/task-form-dialog";
import { TasksTable } from "@/components/catalog/tasks-table";
import { TASK_LIST_INPUT, type TaskRow } from "@/components/catalog/types";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

export default function TasksPage(): React.JSX.Element {
  const format = useFormatSettings();

  const [search, setSearch] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const tasksQuery = trpc.tasks.list.useQuery(TASK_LIST_INPUT, {
    staleTime: 30_000,
  });

  const allTasks = React.useMemo<TaskRow[]>(
    () => tasksQuery.data ?? [],
    [tasksQuery.data],
  );

  const needle = search.trim().toLowerCase();

  const visibleTasks = React.useMemo(
    () =>
      allTasks.filter((task) => {
        if (!showArchived && task.archived) return false;
        if (needle === "") return true;
        return task.name.toLowerCase().includes(needle);
      }),
    [allTasks, showArchived, needle],
  );

  const trackedTotal = visibleTasks.reduce(
    (sum, task) => sum + task.totalSec,
    0,
  );
  const openCount = visibleTasks.filter((task) => !task.done).length;

  return (
    <CatalogScreen
      title="Tasks"
      description="What the work is, independent of which project it was for. An entry can carry a task, a project, both or neither — deleting a task keeps the entries booked on it."
      actionLabel="New task"
      onAction={() => setCreating(true)}
      actionTestId="new-task"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search tasks"
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
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
        isLoading={tasksQuery.isLoading}
        isFiltered={needle !== ""}
        onCreate={() => setCreating(true)}
      />

      <TaskFormDialog open={creating} onOpenChange={setCreating} />
    </CatalogScreen>
  );
}
