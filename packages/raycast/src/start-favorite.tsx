import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useState } from "react";
import {
  isBrokenQuickStart,
  mergeQuickStarts,
  quickStartHint,
  quickStartLabel,
  repairQuickStart,
  type QuickStart,
  type QuickStartItem,
} from "@starter/core";
import { getTracktime } from "./lib/api.js";
import { formatDayHeading } from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { SignedOutView, refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** How many rows the list offers across both tiers. */
const LIMIT = 15;

const load = async (): Promise<QuickStartItem[]> => {
  const api = await getTracktime();
  const [favorites, recents] = await Promise.all([
    api.favorites(),
    api.recents({ limit: LIMIT, days: 30 }),
  ]);
  return mergeQuickStarts({ favorites, recents, limit: LIMIT });
};

/**
 * "Start a favorite" — the pinned things first, then whatever was tracked
 * recently, one Enter away from running.
 *
 * The two tiers share a list rather than living in separate commands: from
 * the keyboard the distinction between "I pinned this" and "I did this on
 * Tuesday" only matters when deciding to pin, never when starting.
 */
export default function StartFavorite(): React.JSX.Element {
  const { data, isLoading, signedOut, revalidate } = useApi(
    "quick-starts",
    load,
  );
  const [busy, setBusy] = useState(false);

  if (signedOut) return <SignedOutView />;

  const items = data ?? [];

  const act = async (
    run: () => Promise<void>,
    failureTitle: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      await run();
      revalidate();
    } catch (error) {
      await showFailureToast(error, failureTitle);
    } finally {
      setBusy(false);
    }
  };

  const start = (item: QuickStartItem): Promise<void> =>
    act(async () => {
      const api = await getTracktime();
      // `repairQuickStart` drops a reference the server would reject; the
      // description is the part the user actually typed, and it survives.
      const quick: QuickStart = repairQuickStart(item);
      await api.startQuick(quick);
      await refreshMenuBar();
      await showToast({
        style: Toast.Style.Success,
        title: "Timer started",
        message: quickStartLabel(item),
      });
      await popToRoot();
    }, "Could not start the timer");

  const pin = (item: QuickStartItem): Promise<void> =>
    act(async () => {
      const api = await getTracktime();
      await api.addFavorite(repairQuickStart(item));
      await showToast({ style: Toast.Style.Success, title: "Pinned" });
    }, "Could not pin this");

  const unpin = (id: string): Promise<void> =>
    act(async () => {
      const api = await getTracktime();
      await api.removeFavorite(id);
      await showToast({ style: Toast.Style.Success, title: "Unpinned" });
    }, "Could not unpin this");

  return (
    <List
      isLoading={isLoading || busy}
      searchBarPlaceholder="Search favorites and recent work…"
    >
      <List.EmptyView
        icon={Icon.Star}
        title="Nothing to start yet"
        description="Track some time, then pin what you do most often."
      />
      {(["favorite", "recent"] as const).map((kind) => {
        const section = items.filter((item) => item.kind === kind);
        if (section.length === 0) return null;

        return (
          <List.Section
            key={kind}
            title={kind === "favorite" ? "Favorites" : "Recent"}
          >
            {section.map((item) => {
              const pinned = item.kind === "favorite";
              const hint = quickStartHint(item);

              return (
                <List.Item
                  key={pinned ? item.id : item.key}
                  title={quickStartLabel(item)}
                  subtitle={hint ?? undefined}
                  icon={
                    item.projectColor === null
                      ? Icon.Circle
                      : {
                          source: Icon.CircleFilled,
                          tintColor: item.projectColor,
                        }
                  }
                  accessories={[
                    ...(item.billable ? [{ icon: Icon.Coins }] : []),
                    ...(isBrokenQuickStart(item)
                      ? [{ icon: Icon.ExclamationMark, tooltip: hint ?? "" }]
                      : []),
                    ...(pinned
                      ? [{ icon: Icon.Star }]
                      : [
                          {
                            text: formatDayHeading(item.lastStart),
                            tooltip: `${item.count} entr${item.count === 1 ? "y" : "ies"}`,
                          },
                        ]),
                  ]}
                  actions={
                    <ActionPanel>
                      <Action
                        title="Start Timer"
                        icon={Icon.Play}
                        onAction={() => {
                          void start(item);
                        }}
                      />
                      {pinned ? (
                        <Action
                          title="Remove from Favorites"
                          icon={Icon.StarDisabled}
                          shortcut={{ modifiers: ["cmd"], key: "f" }}
                          onAction={() => {
                            void unpin(item.id);
                          }}
                        />
                      ) : (
                        <Action
                          title="Add to Favorites"
                          icon={Icon.Star}
                          shortcut={{ modifiers: ["cmd"], key: "f" }}
                          onAction={() => {
                            void pin(item);
                          }}
                        />
                      )}
                      <Action.OpenInBrowser
                        title="Open Web App"
                        url={webLink("/track")}
                        shortcut={{ modifiers: ["cmd"], key: "o" }}
                      />
                    </ActionPanel>
                  }
                />
              );
            })}
          </List.Section>
        );
      })}
    </List>
  );
}
