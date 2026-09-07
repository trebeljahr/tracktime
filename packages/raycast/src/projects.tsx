import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
} from "@raycast/api";
import { useState } from "react";
import { ProjectForm } from "./components/catalog/project-form.js";
import { ProjectTasks } from "./components/catalog/project-tasks.js";
import { getTracktime, type ProjectWithStats } from "./lib/api.js";
import { describeRemoval } from "./lib/catalog.js";
import { formatDurationShort, projectIcon } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** Archived rows are out of the way by default, but never unreachable. */
type Scope = "active" | "all";

export default function Projects(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>("active");
  const projects = useApi(`projects:${scope}`, (api) =>
    api.projects({ includeArchived: scope === "all" }),
  );
  const clients = useApi("clients", (api) => api.clients());

  const run = async (
    action: () => Promise<string>,
    failureTitle: string,
  ): Promise<void> => {
    try {
      const message = await action();
      projects.revalidate();
      await refreshMenuBar();
      await showToast({ style: Toast.Style.Success, title: message });
    } catch (error) {
      await showFailureToast(error, failureTitle);
    }
  };

  const remove = async (project: ProjectWithStats): Promise<void> => {
    const confirmed = await confirmAlert({
      title: `Delete "${project.name}"?`,
      message:
        project.entryCount > 0
          ? `Its tasks go with it. ${project.entryCount} tracked ${
              project.entryCount === 1 ? "entry keeps" : "entries keep"
            } their time and become unfiled. This cannot be undone — archive it instead to keep it out of the way.`
          : "Its tasks go with it. This cannot be undone.",
      icon: Icon.Trash,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    await run(async () => {
      const api = await getTracktime();
      const result = await api.removeProject(project.id);
      return `Project deleted — ${describeRemoval(result)}`;
    }, "Could not delete the project");
  };

  if (projects.signedOut) return <SignedOutView />;

  const newProject = (
    <Action.Push
      title="New Project…"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={<ProjectForm onSaved={projects.revalidate} />}
    />
  );

  return (
    <List
      isLoading={projects.isLoading || clients.isLoading}
      searchBarPlaceholder="Search projects…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Which projects"
          value={scope}
          onChange={(value) => setScope(value as Scope)}
        >
          <List.Dropdown.Item value="active" title="Active" icon={Icon.Circle} />
          <List.Dropdown.Item
            value="all"
            title="Including archived"
            icon={Icon.Box}
          />
        </List.Dropdown>
      }
      actions={<ActionPanel>{newProject}</ActionPanel>}
    >
      <List.EmptyView
        icon={Icon.Folder}
        title="No projects yet"
        description="Projects are what time is filed against. Create the first one."
        actions={<ActionPanel>{newProject}</ActionPanel>}
      />

      {(projects.data ?? []).map((project) => (
        <List.Item
          key={project.id}
          icon={projectIcon(project.color)}
          title={project.name}
          subtitle={project.clientName ?? undefined}
          accessories={[
            ...(project.archived
              ? [{ tag: { value: "archived", color: Color.SecondaryText } }]
              : []),
            ...(project.billableDefault
              ? [
                  {
                    icon: { source: Icon.BankNote, tintColor: Color.Green },
                    tooltip: "Billable by default",
                  },
                ]
              : []),
            {
              text: `${project.entryCount} ${
                project.entryCount === 1 ? "entry" : "entries"
              }`,
            },
            {
              tag: {
                value: formatDurationShort(project.totalSec),
                color: Color.SecondaryText,
              },
            },
          ]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action.Push
                  title="Show Tasks"
                  icon={Icon.List}
                  target={<ProjectTasks project={project} />}
                />
                <Action
                  title="Start Timer on This Project"
                  icon={Icon.Play}
                  shortcut={{ modifiers: ["cmd"], key: "t" }}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.start({
                        description: "",
                        projectId: project.id,
                        billable: project.billableDefault,
                      });
                      return `Started — ${project.name}`;
                    }, "Could not start the timer")
                  }
                />
                <Action.Push
                  title="Edit Project…"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={
                    <ProjectForm
                      project={project}
                      onSaved={projects.revalidate}
                    />
                  }
                />
              </ActionPanel.Section>

              <ActionPanel.Section>
                {newProject}
                <Action.Push
                  title="New Task…"
                  icon={Icon.Plus}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                  target={<ProjectTasks project={project} />}
                />
                <Action
                  title={project.archived ? "Unarchive Project" : "Archive Project"}
                  icon={project.archived ? Icon.Tray : Icon.Box}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.archiveProject(project.id, !project.archived);
                      return project.archived
                        ? "Project unarchived"
                        : "Project archived";
                    }, "Could not archive the project")
                  }
                />
                <Action.OpenInBrowser
                  title="Open Web App"
                  url={webLink("/projects")}
                  shortcut={{ modifiers: ["cmd"], key: "o" }}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={projects.revalidate}
                />
              </ActionPanel.Section>

              <ActionPanel.Section>
                <Action
                  title="Delete Project"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => remove(project)}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
