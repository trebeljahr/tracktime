"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ConfirmDialog } from "./confirm-dialog";
import { ProjectFormDialog } from "./project-form-dialog";
import { TaskPanel } from "./task-panel";
import type { ClientRow, ProjectRow } from "./types";
import { useProjectMutations } from "./use-catalog-mutations";

export type ProjectsTableProps = {
  projects: ProjectRow[];
  clients: ClientRow[];
  isLoading: boolean;
  showArchived: boolean;
  /** True when filters are hiding rows, so the empty state can say so. */
  isFiltered: boolean;
  onCreate: () => void;
};

const COLUMN_COUNT = 8;

function ColorDot({ color }: { color: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export function ProjectsTable({
  projects,
  clients,
  isLoading,
  showArchived,
  isFiltered,
  onCreate,
}: ProjectsTableProps): React.JSX.Element {
  const format = useFormatSettings();
  const { setProjectArchived, removeProject } = useProjectMutations();

  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ProjectRow | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ProjectRow | null>(
    null,
  );

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="projects-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title={isFiltered ? "No projects match these filters" : "No projects yet"}
        description={
          isFiltered
            ? "Try clearing the search or client filter, or turn on “Show archived”."
            : "Projects group tracked time and carry the billing defaults for new entries."
        }
        action={
          isFiltered ? undefined : (
            <Button onClick={onCreate} data-testid="projects-empty-create">
              <Plus className="size-4" />
              New project
            </Button>
          )
        }
        testId="projects-empty"
      />
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border">
        <Table data-testid="projects-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Project</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Billable</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Tracked</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const expanded = expandedId === project.id;
              return (
                <React.Fragment key={project.id}>
                  <TableRow
                    data-testid={`project-row-${project.id}`}
                    data-archived={project.archived ? "true" : "false"}
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={expanded ? "Hide tasks" : "Show tasks"}
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedId(expanded ? null : project.id)
                        }
                        data-testid={`project-expand-${project.id}`}
                      >
                        {expanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </Button>
                    </TableCell>

                    <TableCell>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() =>
                          setExpandedId(expanded ? null : project.id)
                        }
                        data-testid={`project-name-${project.id}`}
                      >
                        <ColorDot color={project.color} />
                        <span className="truncate font-medium">
                          {project.name}
                        </span>
                        {project.archived ? (
                          <Badge variant="outline" className="shrink-0">
                            Archived
                          </Badge>
                        ) : null}
                      </button>
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {project.clientName ? (
                        <span className="flex items-center gap-2">
                          <ColorDot color={project.clientColor ?? "#64748b"} />
                          <span className="truncate">{project.clientName}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70">—</span>
                      )}
                    </TableCell>

                    <TableCell>
                      {project.billableDefault ? (
                        <Badge variant="secondary">Billable</Badge>
                      ) : (
                        <span className="text-muted-foreground/70">
                          Non-billable
                        </span>
                      )}
                    </TableCell>

                    <TableCell
                      className="text-right tabular-nums"
                      data-testid={`project-rate-${project.id}`}
                    >
                      {project.hourlyRate === null ? (
                        <span className="text-muted-foreground/70">Default</span>
                      ) : (
                        format.money(project.hourlyRate)
                      )}
                    </TableCell>

                    <TableCell
                      className="text-right tabular-nums"
                      data-testid={`project-tracked-${project.id}`}
                    >
                      {format.duration(project.totalSec)}
                    </TableCell>

                    <TableCell
                      className="text-right tabular-nums text-muted-foreground"
                      data-testid={`project-entries-${project.id}`}
                    >
                      {project.entryCount}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Actions for ${project.name}`}
                            data-testid={`project-menu-${project.id}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setEditing(project)}
                            data-testid={`project-edit-${project.id}`}
                          >
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setProjectArchived(project.id, !project.archived)
                            }
                            data-testid={`project-archive-${project.id}`}
                          >
                            {project.archived ? (
                              <ArchiveRestore className="size-4" />
                            ) : (
                              <Archive className="size-4" />
                            )}
                            {project.archived ? "Unarchive" : "Archive"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setPendingDelete(project)}
                            data-testid={`project-delete-${project.id}`}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>

                  {expanded ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <TaskPanel
                          projectId={project.id}
                          projectName={project.name}
                          showArchived={showArchived}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ProjectFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        project={editing}
        clients={clients}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description={
          pendingDelete && pendingDelete.entryCount > 0
            ? `${pendingDelete.entryCount} time ${
                pendingDelete.entryCount === 1 ? "entry" : "entries"
              } reference this project, so it will be archived instead of deleted.`
            : "This project has no tracked time, so it will be deleted along with its tasks."
        }
        confirmLabel={
          pendingDelete && pendingDelete.entryCount > 0
            ? "Archive project"
            : "Delete project"
        }
        onConfirm={() => {
          if (pendingDelete) removeProject(pendingDelete.id);
          setPendingDelete(null);
        }}
        testId="confirm-project-delete"
      />
    </>
  );
}
