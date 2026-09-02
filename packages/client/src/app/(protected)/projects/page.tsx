"use client";

import * as React from "react";
import { overallBudgetStatus } from "@starter/shared";

import { CatalogScreen } from "@/components/catalog/catalog-screen";
import { ProjectFormDialog } from "@/components/catalog/project-form-dialog";
import { ProjectsTable } from "@/components/catalog/projects-table";
import {
  CLIENT_LIST_INPUT,
  PROJECT_LIST_INPUT,
  type ClientRow,
  type ProjectRow,
} from "@/components/catalog/types";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** Sentinel used by the client filter for "projects with no client". */
const NO_CLIENT = "__none";

const matches = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle);

export default function ProjectsPage(): React.JSX.Element {
  const format = useFormatSettings();

  const [search, setSearch] = React.useState("");
  const [clientFilter, setClientFilter] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const projectsQuery = trpc.projects.list.useQuery(PROJECT_LIST_INPUT, {
    staleTime: 30_000,
  });
  const clientsQuery = trpc.clients.list.useQuery(CLIENT_LIST_INPUT, {
    staleTime: 30_000,
  });

  const allProjects = React.useMemo<ProjectRow[]>(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const allClients = React.useMemo<ClientRow[]>(
    () => clientsQuery.data ?? [],
    [clientsQuery.data],
  );

  const needle = search.trim().toLowerCase();

  const visibleProjects = React.useMemo(
    () =>
      allProjects.filter((project) => {
        if (!showArchived && project.archived) return false;
        if (clientFilter === NO_CLIENT && project.clientId !== null) {
          return false;
        }
        if (
          clientFilter !== null &&
          clientFilter !== NO_CLIENT &&
          project.clientId !== clientFilter
        ) {
          return false;
        }
        if (needle === "") return true;
        return (
          project.name.toLowerCase().includes(needle) ||
          matches(project.clientName, needle)
        );
      }),
    [allProjects, showArchived, clientFilter, needle],
  );

  const clientFilterOptions = React.useMemo<ComboboxOption[]>(
    () => [
      { value: NO_CLIENT, label: "No client", color: null },
      ...allClients.map((client) => ({
        value: client.id,
        label: client.archived ? `${client.name} (archived)` : client.name,
        color: client.color,
      })),
    ],
    [allClients],
  );

  const trackedTotal = visibleProjects.reduce(
    (sum, project) => sum + project.totalSec,
    0,
  );

  // The only "alert" this tool has: a count in the summary line. A solo user
  // reading their own project list does not need to be notified as well.
  const overBudget = visibleProjects.filter(
    (project) =>
      project.progress !== null &&
      overallBudgetStatus(project.progress) === "over",
  ).length;

  return (
    <CatalogScreen
      title="Projects"
      description="Projects group tracked time and carry the billing defaults for new entries. Deleting one keeps its time entries — they just become project-less."
      actionLabel="New project"
      onAction={() => setCreating(true)}
      actionTestId="new-project"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search projects or clients"
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      filters={
        <Combobox
          options={clientFilterOptions}
          value={clientFilter}
          onChange={setClientFilter}
          placeholder="All clients"
          searchPlaceholder="Filter by client..."
          emptyText="No clients yet."
          allowClear
          clearLabel="All clients"
          className="w-52"
          data-testid="catalog-client-filter"
        />
      }
      summary={
        <>
          {visibleProjects.length}{" "}
          {visibleProjects.length === 1 ? "project" : "projects"} ·{" "}
          {format.duration(trackedTotal)} tracked
          {overBudget > 0 ? (
            <span className="text-destructive" data-testid="projects-over-budget">
              {" · "}
              {overBudget} over budget
            </span>
          ) : null}
        </>
      }
      hasError={projectsQuery.isError}
      testId="projects-page"
    >
      <ProjectsTable
        projects={visibleProjects}
        clients={allClients}
        isLoading={projectsQuery.isLoading}
        showArchived={showArchived}
        isFiltered={needle !== "" || clientFilter !== null}
        onCreate={() => setCreating(true)}
      />

      <ProjectFormDialog
        open={creating}
        onOpenChange={setCreating}
        clients={allClients}
      />
    </CatalogScreen>
  );
}
