"use client";

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
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
import { ClientFormDialog } from "./client-form-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import type { ClientRow, ProjectRow } from "./types";
import { useClientMutations } from "./use-catalog-mutations";

/** Roll-ups a client owns, derived from the already-loaded project list. */
type ClientStats = {
  projectCount: number;
  totalSec: number;
  entryCount: number;
};

const EMPTY_STATS: ClientStats = {
  projectCount: 0,
  totalSec: 0,
  entryCount: 0,
};

export function clientStatsByClientId(
  projects: ProjectRow[],
): Map<string, ClientStats> {
  const stats = new Map<string, ClientStats>();
  for (const project of projects) {
    if (project.clientId === null) continue;
    const current = stats.get(project.clientId) ?? { ...EMPTY_STATS };
    stats.set(project.clientId, {
      projectCount: current.projectCount + 1,
      totalSec: current.totalSec + project.totalSec,
      entryCount: current.entryCount + project.entryCount,
    });
  }
  return stats;
}

export type ClientsTableProps = {
  clients: ClientRow[];
  /** Every project (archived included) — the source of the roll-ups. */
  projects: ProjectRow[];
  isLoading: boolean;
  isFiltered: boolean;
  onCreate: () => void;
};

export function ClientsTable({
  clients,
  projects,
  isLoading,
  isFiltered,
  onCreate,
}: ClientsTableProps): React.JSX.Element {
  const format = useFormatSettings();
  const { setClientArchived, removeClient } = useClientMutations();

  const [editing, setEditing] = React.useState<ClientRow | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ClientRow | null>(
    null,
  );

  const stats = React.useMemo(
    () => clientStatsByClientId(projects),
    [projects],
  );

  const pendingStats = pendingDelete
    ? (stats.get(pendingDelete.id) ?? EMPTY_STATS)
    : EMPTY_STATS;

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="clients-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={isFiltered ? "No clients match these filters" : "No clients yet"}
        description={
          isFiltered
            ? "Try clearing the search, or turn on “Show archived”."
            : "Clients sit above projects and roll their tracked time together."
        }
        action={
          isFiltered ? undefined : (
            <Button onClick={onCreate} data-testid="clients-empty-create">
              <Plus className="size-4" />
              New client
            </Button>
          )
        }
        testId="clients-empty"
      />
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border">
        <Table data-testid="clients-table">
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Tracked</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => {
              const rollup = stats.get(client.id) ?? EMPTY_STATS;
              return (
                <TableRow
                  key={client.id}
                  data-testid={`client-row-${client.id}`}
                  data-archived={client.archived ? "true" : "false"}
                >
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: client.color }}
                      />
                      <span className="truncate font-medium">
                        {client.name}
                      </span>
                      {client.archived ? (
                        <Badge variant="outline" className="shrink-0">
                          Archived
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell
                    className="text-right tabular-nums text-muted-foreground"
                    data-testid={`client-projects-${client.id}`}
                  >
                    {rollup.projectCount}
                  </TableCell>

                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`client-tracked-${client.id}`}
                  >
                    {format.duration(rollup.totalSec)}
                  </TableCell>

                  <TableCell
                    className="text-right tabular-nums text-muted-foreground"
                    data-testid={`client-entries-${client.id}`}
                  >
                    {rollup.entryCount}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Actions for ${client.name}`}
                          data-testid={`client-menu-${client.id}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setEditing(client)}
                          data-testid={`client-edit-${client.id}`}
                        >
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setClientArchived(client.id, !client.archived)
                          }
                          data-testid={`client-archive-${client.id}`}
                        >
                          {client.archived ? (
                            <ArchiveRestore className="size-4" />
                          ) : (
                            <Archive className="size-4" />
                          )}
                          {client.archived ? "Unarchive" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDelete(client)}
                          data-testid={`client-delete-${client.id}`}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ClientFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        client={editing}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        description={
          pendingStats.entryCount > 0
            ? `${pendingStats.entryCount} time ${
                pendingStats.entryCount === 1 ? "entry" : "entries"
              } across ${pendingStats.projectCount} ${
                pendingStats.projectCount === 1 ? "project" : "projects"
              } reference this client, so it will be archived instead of deleted.`
            : "This client has no tracked time. Its projects will be kept and detached from it."
        }
        confirmLabel={
          pendingStats.entryCount > 0 ? "Archive client" : "Delete client"
        }
        onConfirm={() => {
          if (pendingDelete) {
            removeClient(pendingDelete.id, pendingStats.entryCount);
          }
          setPendingDelete(null);
        }}
        testId="confirm-client-delete"
      />
    </>
  );
}
