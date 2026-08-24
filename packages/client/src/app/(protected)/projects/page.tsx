"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";

import { ClientFormDialog } from "@/components/catalog/client-form-dialog";
import { ClientsTable } from "@/components/catalog/clients-table";
import { ProjectFormDialog } from "@/components/catalog/project-form-dialog";
import { ProjectsTable } from "@/components/catalog/projects-table";
import {
  CLIENT_LIST_INPUT,
  PROJECT_LIST_INPUT,
  type ClientRow,
  type ProjectRow,
} from "@/components/catalog/types";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

/** Sentinel used by the client filter for "projects with no client". */
const NO_CLIENT = "__none";

type CatalogTab = "projects" | "clients";

const matches = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle);

export default function ProjectsPage(): React.JSX.Element {
  const format = useFormatSettings();

  const [tab, setTab] = React.useState<CatalogTab>("projects");
  const [search, setSearch] = React.useState("");
  const [clientFilter, setClientFilter] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [creatingClient, setCreatingClient] = React.useState(false);

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

  const visibleClients = React.useMemo(
    () =>
      allClients.filter((client) => {
        if (!showArchived && client.archived) return false;
        if (needle === "") return true;
        return client.name.toLowerCase().includes(needle);
      }),
    [allClients, showArchived, needle],
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

  const isFiltered = needle !== "" || clientFilter !== null;
  const hasError =
    projectsQuery.isError || (tab === "clients" && clientsQuery.isError);

  return (
    <div className="space-y-6" data-testid="projects-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage clients, projects and tasks. Archiving keeps past time
            entries intact — nothing tracked is ever lost.
          </p>
        </div>
        {tab === "projects" ? (
          <Button onClick={() => setCreatingProject(true)} data-testid="new-project">
            <Plus className="size-4" />
            New project
          </Button>
        ) : (
          <Button onClick={() => setCreatingClient(true)} data-testid="new-client">
            <Plus className="size-4" />
            New client
          </Button>
        )}
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as CatalogTab)}
        data-testid="catalog-tabs"
      >
        <TabsList>
          <TabsTrigger value="projects" data-testid="tab-projects">
            Projects
          </TabsTrigger>
          <TabsTrigger value="clients" data-testid="tab-clients">
            Clients
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              placeholder={
                tab === "projects"
                  ? "Search projects or clients"
                  : "Search clients"
              }
              aria-label="Search catalog"
              className="pl-8"
              onChange={(event) => setSearch(event.target.value)}
              data-testid="catalog-search"
            />
          </div>

          {tab === "projects" ? (
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
          ) : null}

          <div className="flex items-center gap-2">
            <Switch
              id="show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
              data-testid="catalog-show-archived"
            />
            <Label htmlFor="show-archived" className="text-sm font-normal">
              Show archived
            </Label>
          </div>
        </div>

        {hasError ? (
          <p
            className="mt-4 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
            data-testid="catalog-error"
          >
            Could not load the catalog. Check your connection and try again.
          </p>
        ) : null}

        <TabsContent value="projects" className="mt-4 space-y-3">
          <p
            className="text-xs text-muted-foreground"
            data-testid="projects-summary"
          >
            {visibleProjects.length}{" "}
            {visibleProjects.length === 1 ? "project" : "projects"} ·{" "}
            {format.duration(trackedTotal)} tracked
          </p>
          <ProjectsTable
            projects={visibleProjects}
            clients={allClients}
            isLoading={projectsQuery.isLoading}
            showArchived={showArchived}
            isFiltered={isFiltered}
            onCreate={() => setCreatingProject(true)}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-4 space-y-3">
          <p
            className="text-xs text-muted-foreground"
            data-testid="clients-summary"
          >
            {visibleClients.length}{" "}
            {visibleClients.length === 1 ? "client" : "clients"}
          </p>
          <ClientsTable
            clients={visibleClients}
            projects={allProjects}
            isLoading={clientsQuery.isLoading}
            isFiltered={needle !== ""}
            onCreate={() => setCreatingClient(true)}
          />
        </TabsContent>
      </Tabs>

      <ProjectFormDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        clients={allClients}
      />
      <ClientFormDialog
        open={creatingClient}
        onOpenChange={setCreatingClient}
      />
    </div>
  );
}
