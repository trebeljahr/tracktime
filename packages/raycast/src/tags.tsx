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
import { TagForm } from "./components/catalog/tag-form.js";
import { getTracktime, type TagWithStats } from "./lib/api.js";
import { describeTagRemoval } from "./lib/catalog.js";
import { formatDurationShort, projectIcon } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, showFailureToast } from "./lib/ui.js";

type Scope = "active" | "all";

export default function Tags(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>("active");
  const tags = useApi(`tags:${scope}`, (api) =>
    api.tags({ includeArchived: scope === "all" }),
  );

  const run = async (
    action: () => Promise<string>,
    failureTitle: string,
  ): Promise<void> => {
    try {
      const message = await action();
      tags.revalidate();
      await showToast({ style: Toast.Style.Success, title: message });
    } catch (error) {
      await showFailureToast(error, failureTitle);
    }
  };

  /**
   * The server archives a tag that is still on tracked time rather than
   * deleting it, so the confirmation says which of the two this will be — a
   * dialog that promises a delete and performs an archive is a lie, even a
   * well-meant one.
   */
  const remove = async (tag: TagWithStats): Promise<void> => {
    const used = tag.entryCount > 0;
    const confirmed = await confirmAlert({
      title: used ? `Archive "${tag.name}"?` : `Delete "${tag.name}"?`,
      message: used
        ? `It is on ${tag.entryCount} tracked ${
            tag.entryCount === 1 ? "entry" : "entries"
          }, so it will be archived instead of deleted — reports keep their bucket.`
        : "Nothing carries this tag, so it will be deleted outright.",
      icon: used ? Icon.Box : Icon.Trash,
      primaryAction: {
        title: used ? "Archive" : "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    await run(async () => {
      const api = await getTracktime();
      return describeTagRemoval(await api.removeTag(tag.id));
    }, "Could not remove the tag");
  };

  if (tags.signedOut) return <SignedOutView />;

  const newTag = (
    <Action.Push
      title="New Tag…"
      icon={Icon.Plus}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={<TagForm onSaved={tags.revalidate} />}
    />
  );

  return (
    <List
      isLoading={tags.isLoading}
      searchBarPlaceholder="Search tags…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Which tags"
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
      actions={<ActionPanel>{newTag}</ActionPanel>}
    >
      <List.EmptyView
        icon={Icon.Tag}
        title="No tags yet"
        description="Tags cut across projects — “invoicing”, “deep work”, anything you want to report on."
        actions={<ActionPanel>{newTag}</ActionPanel>}
      />

      {(tags.data ?? []).map((tag) => (
        <List.Item
          key={tag.id}
          icon={projectIcon(tag.color)}
          title={tag.name}
          accessories={[
            ...(tag.archived
              ? [{ tag: { value: "archived", color: Color.SecondaryText } }]
              : []),
            {
              text: `${tag.entryCount} ${
                tag.entryCount === 1 ? "entry" : "entries"
              }`,
            },
            {
              tag: {
                value: formatDurationShort(tag.totalSec),
                color: Color.SecondaryText,
              },
            },
          ]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action.Push
                  title="Edit Tag…"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={<TagForm tag={tag} onSaved={tags.revalidate} />}
                />
                {newTag}
              </ActionPanel.Section>

              <ActionPanel.Section>
                <Action
                  title={tag.archived ? "Unarchive Tag" : "Archive Tag"}
                  icon={tag.archived ? Icon.Tray : Icon.Box}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                  onAction={() =>
                    run(async () => {
                      const api = await getTracktime();
                      await api.updateTag({
                        id: tag.id,
                        archived: !tag.archived,
                      });
                      return tag.archived ? "Tag unarchived" : "Tag archived";
                    }, "Could not archive the tag")
                  }
                />
                <Action.OpenInBrowser
                  title="Open Web App"
                  url={webLink("/tags")}
                  shortcut={{ modifiers: ["cmd"], key: "o" }}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={tags.revalidate}
                />
              </ActionPanel.Section>

              <ActionPanel.Section>
                <Action
                  title={tag.entryCount > 0 ? "Archive Tag…" : "Delete Tag"}
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => remove(tag)}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
