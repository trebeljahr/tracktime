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
import type { Client } from "@starter/core";
import { useState } from "react";
import { ClientForm } from "./components/catalog/client-form.js";
import { ProjectForm } from "./components/catalog/project-form.js";
import { getTracktime } from "./lib/api.js";
import { describeRemoval } from "./lib/catalog.js";
import { formatDurationShort, projectIcon } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, showFailureToast } from "./lib/ui.js";

type Scope = "active" | "all";

export default function Clients(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>("active");
  const clients = useApi(`clients:${scope}`, (api) =>
    api.clients({ includeArchived: scope === "all" }),
  );
  // Loaded alongside so each client can show what it is worth without a
  // second round trip per row.
  const projects = useApi("projects:all", (api) =>
    api.projects({ includeArchived: true }),
  );

  const run = async (
    action: () => Promise<string>,
    failureTitle: string,
  ): Promise<void> => {
    try {
      const message = await action();
      clients.revalidate();
      projects.revalidate();
      await showToast({ style: Toast.Style.Success, title: message });
    } catch (error) {
      await showFailureToast(error, failureTitle);
    }
  };

  const remove = async (client: Client, projectCount: number): Promise<void> => {
    const confirmed = await confirmAlert({
      title: `Delete "${client.name}"?`,
      message:
        projectCount > 0
          ? `${projectCount} ${
              projectCount === 1 ? "project keeps" : "projects keep"
            } their time and lose the client. This cannot be undone — archive it instead to keep it out of the way.`
          : "This cannot be undone.",
      icon: Icon.Trash,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    await run(async () => {
      const api = await getTracktime();
      const result = await api.removeClient(client.id);
      return `Client deleted — ${describeRemoval(result)}`;
    }, "Could not delete the client");
  };

  if (clients.signedOut) return <SignedOutView />;

  const forClient = (
    clientId: string,
  ): { count: number; totalSec: number } => {
    const owned = (projects.data ?? []).filter(
      (project) => project.clientId === clientId,
    );
    return {
      count: owned.length,
      totalSec: owned.reduce((total, project) => total + project.totalSec, 0),
    };
  };

  const newClient = (
    <Action.Push
      title="New Client…"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={<ClientForm onSaved={clients.revalidate} />}
    />
  );

  return (
    <List
      isLoading={clients.isLoading || projects.isLoading}
      searchBarPlaceholder="Search clients…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Which clients"
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
      actions={<ActionPanel>{newClient}</ActionPanel>}
    >
      <List.EmptyView
        icon={Icon.PersonCircle}
        title="No clients yet"
        description="Clients sit above projects. Add one when you bill more than one party."
        actions={<ActionPanel>{newClient}</ActionPanel>}
      />

      {(clients.data ?? []).map((client) => {
        const stats = forClient(client.id);

        return (
          <List.Item
            key={client.id}
            icon={projectIcon(client.color)}
            title={client.name}
            accessories={[
              ...(client.archived
                ? [{ tag: { value: "archived", color: Color.SecondaryText } }]
                : []),
              {
                text: `${stats.count} ${
                  stats.count === 1 ? "project" : "projects"
                }`,
              },
              {
                tag: {
                  value: formatDurationShort(stats.totalSec),
                  color: Color.SecondaryText,
                },
              },
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action.Push
                    title="Edit Client…"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd"], key: "e" }}
                    target={
                      <ClientForm client={client} onSaved={clients.revalidate} />
                    }
                  />
                  <Action.Push
                    title="New Project for This Client…"
                    icon={Icon.Folder}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                    target={
                      <ProjectForm
                        clientId={client.id}
                        onSaved={projects.revalidate}
                      />
                    }
                  />
                </ActionPanel.Section>

                <ActionPanel.Section>
                  {newClient}
                  <Action
                    title={client.archived ? "Unarchive Client" : "Archive Client"}
                    icon={client.archived ? Icon.Tray : Icon.Box}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                    onAction={() =>
                      run(async () => {
                        const api = await getTracktime();
                        await api.archiveClient(client.id, !client.archived);
                        return client.archived
                          ? "Client unarchived"
                          : "Client archived";
                      }, "Could not archive the client")
                    }
                  />
                  <Action.OpenInBrowser
                    title="Open Web App"
                    url={webLink("/clients")}
                    shortcut={{ modifiers: ["cmd"], key: "o" }}
                  />
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={clients.revalidate}
                  />
                </ActionPanel.Section>

                <ActionPanel.Section>
                  <Action
                    title="Delete Client"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => remove(client, stats.count)}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
