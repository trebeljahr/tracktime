"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormatSettings } from "@/lib/format";
import { useAllTimeRange } from "@/lib/entry-links";
import { CatalogName } from "./catalog-name";
import { ConfirmDialog } from "./confirm-dialog";
import { EntriesLink, ShowEntriesItem } from "./entries-link";
import { ProjectFormDialog } from "./project-form-dialog";
import { TaskFormDialog } from "./task-form-dialog";
import type { ClientRow, ProjectRow, TaskRow } from "./types";
import { useTaskMutations } from "./use-catalog-mutations";

export type TasksTableProps = {
  tasks: TaskRow[];
  /**
   * Every project, so the Project cell can open the project it names. A task
   * row carries its project's name and colour but not the row itself.
   */
  projects: ProjectRow[];
  /** Passed straight through to the project dialog opened from a row. */
  clients: ClientRow[];
  isLoading: boolean;
  /** True when filters are hiding rows, so the empty state can say so. */
  isFiltered: boolean;
  onCreate: () => void;
};

/** Every task the owner has, across projects — the Tasks manage screen. */
export function TasksTable({
  tasks,
  projects,
  clients,
  isLoading,
  isFiltered,
  onCreate,
}: TasksTableProps): React.JSX.Element {
  const format = useFormatSettings();
  const { updateTask, setTaskArchived, removeTask } = useTaskMutations(null);
  // The Tracked column is a lifetime total, so its link has to span one too.
  const allTime = useAllTimeRange();

  const [editing, setEditing] = React.useState<TaskRow | null>(null);
  /** The task row's project, opened for editing from the Project cell. */
  const [editingProject, setEditingProject] = React.useState<ProjectRow | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = React.useState<TaskRow | null>(
    null,
  );

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="tasks-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={isFiltered ? "No tasks match these filters" : "No tasks yet"}
        description={
          isFiltered
            ? "Try clearing the search or project filter, or turn on “Show archived”."
            : "Tasks break a project down. Time can still be tracked straight on the project."
        }
        action={
          isFiltered ? undefined : (
            <Button onClick={onCreate} data-testid="tasks-empty-create">
              <Plus className="size-4" />
              New task
            </Button>
          )
        }
        testId="tasks-empty"
      />
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border">
        <Table data-testid="tasks-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Task</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Tracked</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow
                key={task.id}
                data-testid={`task-row-${task.id}`}
                data-archived={task.archived ? "true" : "false"}
              >
                <TableCell>
                  <Checkbox
                    checked={task.done}
                    aria-label={`Mark ${task.name} done`}
                    onCheckedChange={(checked) => {
                      void updateTask({ id: task.id, done: checked === true });
                    }}
                    data-testid={`task-done-${task.id}`}
                  />
                </TableCell>

                <TableCell>
                  <CatalogName
                    name={task.name}
                    archived={task.archived}
                    done={task.done}
                    editLabel={`Edit task "${task.name}"`}
                    onEdit={() => setEditing(task)}
                    nameTestId={`task-name-${task.id}`}
                  />
                </TableCell>

                <TableCell className="text-muted-foreground">
                  {task.projectName ? (
                    <CatalogName
                      name={task.projectName}
                      color={task.projectColor}
                      nameClassName="font-normal"
                      editLabel={`Edit project "${task.projectName}"`}
                      onEdit={() => {
                        const project = projects.find(
                          (row) => row.id === task.projectId,
                        );
                        if (project) setEditingProject(project);
                      }}
                      testId={`task-project-${task.id}`}
                    />
                  ) : (
                    <span className="text-muted-foreground/70">—</span>
                  )}
                </TableCell>

                <TableCell
                  className="text-right tabular-nums"
                  data-testid={`task-total-${task.id}`}
                >
                  <EntriesLink
                    target={{
                      dimension: "task",
                      id: task.id,
                      projectId: task.projectId,
                    }}
                    range={allTime}
                    label={task.name}
                    testId={`task-total-link-${task.id}`}
                  >
                    {format.duration(task.totalSec)}
                  </EntriesLink>
                </TableCell>

                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Actions for ${task.name}`}
                        data-testid={`task-menu-${task.id}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <ShowEntriesItem
                        target={{
                          dimension: "task",
                          id: task.id,
                          projectId: task.projectId,
                        }}
                        range={allTime}
                        testId={`task-entries-menu-${task.id}`}
                      />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setEditing(task)}
                        data-testid={`task-edit-${task.id}`}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setTaskArchived(task.id, !task.archived)
                        }
                        data-testid={`task-archive-${task.id}`}
                      >
                        {task.archived ? (
                          <ArchiveRestore className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                        {task.archived ? "Unarchive" : "Archive"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setPendingDelete(task)}
                        data-testid={`task-delete-${task.id}`}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ProjectFormDialog
        open={editingProject !== null}
        onOpenChange={(next) => {
          if (!next) setEditingProject(null);
        }}
        project={editingProject}
        clients={clients}
      />

      <TaskFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        task={editing}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description={
          pendingDelete && pendingDelete.totalSec > 0
            ? "Entries booked on this task keep their tracked time and their project — they simply lose the task."
            : "No time is tracked against this task."
        }
        confirmLabel="Delete task"
        onConfirm={() => {
          if (pendingDelete) removeTask(pendingDelete.id);
          setPendingDelete(null);
        }}
        testId="confirm-task-delete"
      />
    </>
  );
}
