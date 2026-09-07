import {
  Icon,
  LaunchType,
  MenuBarExtra,
  Toast,
  getPreferenceValues,
  launchCommand,
  open,
  showToast,
} from "@raycast/api";
import {
  entryDurationSec,
  quickStartHint,
  quickStartLabel,
  repairQuickStart,
  toQuickStart,
  type DetailedEntry,
} from "@starter/core";
import { getTracktime, type ProjectWithStats } from "./lib/api.js";
import { BRAND_MARK } from "./lib/brand.js";
import {
  formatClock,
  formatDurationShort,
  formatMenuBarDuration,
} from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import {
  entryHint,
  entryLabel,
  favoriteFor,
  loadTimerSnapshot,
} from "./lib/timer-data.js";
import { showFailureToast } from "./lib/ui.js";

/** A dropdown is a glance, not a browser — six rows is already a lot. */
const RECENT_LIMIT = 6;

/** The live command, where the clock ticks and forms can be pushed. */
const openTimer = (): void => {
  void launchCommand({ name: "timer", type: LaunchType.UserInitiated });
};

export default function MenuBar(): React.JSX.Element | null {
  const { titleMode, hideWhenIdle } =
    getPreferenceValues<Preferences.MenuBar>();
  const { data, isLoading, signedOut, revalidate } = useApi("menu-bar", (api) =>
    loadTimerSnapshot(api, { recentLimit: RECENT_LIMIT }),
  );

  if (signedOut) {
    return (
      <MenuBarExtra icon={BRAND_MARK} tooltip="tracktime — not signed in">
        <MenuBarExtra.Item
          title="Sign in to tracktime"
          icon={Icon.Key}
          onAction={openTimer}
        />
      </MenuBarExtra>
    );
  }

  const running = data?.running ?? null;
  if (!running && !isLoading && hideWhenIdle) return null;

  const elapsed = running ? entryDurationSec(running, Date.now()) : 0;
  const clock = formatMenuBarDuration(elapsed);
  const label = running ? entryLabel(running) : "";
  const favorites = data?.favorites ?? [];
  const projects = data?.projects ?? [];
  const pinned = running ? favoriteFor(running, favorites) : undefined;

  const title = ((): string | undefined => {
    if (titleMode === "icon") return undefined;

    // Idle used to render as a bare stopwatch glyph with no text at all,
    // which is indistinguishable from the dozen other icons up there — the
    // item was present and simply could not be found. Today's total is the
    // number worth glancing at when nothing is running, and it keeps the
    // item legible. "Description only" stays empty: there is no description
    // to show, and that mode asked for nothing else.
    if (!running) {
      return titleMode === "description"
        ? undefined
        : formatMenuBarDuration(data?.todaySec ?? 0);
    }

    if (titleMode === "duration") return clock;
    if (titleMode === "description") return label;
    return `${label} · ${clock}`;
  })();

  const act = async (
    run: () => Promise<void>,
    failureTitle: string,
  ): Promise<void> => {
    try {
      await run();
      revalidate();
    } catch (error) {
      await showFailureToast(error, failureTitle);
    }
  };

  /**
   * File the running timer from the menu bar. The task is cleared with the
   * project because a task only exists inside one — keeping it would leave
   * the entry pointing at a task from a project it is no longer in.
   */
  const fileUnder = (
    entry: DetailedEntry,
    project: ProjectWithStats | null,
  ): void => {
    void act(async () => {
      const api = await getTracktime();
      await api.update({
        id: entry.id,
        projectId: project?.id ?? null,
        taskId: null,
      });
      await showToast({
        style: Toast.Style.Success,
        title: project ? `Moved to ${project.name}` : "Project cleared",
      });
    }, "Could not change the project");
  };

  return (
    <MenuBarExtra
      icon={BRAND_MARK}
      title={title}
      isLoading={isLoading}
      tooltip={
        running
          ? `${label} — ${clock}`
          : `tracktime — no timer running · today ${formatDurationShort(
              data?.todaySec ?? 0,
            )}`
      }
    >
      {running ? (
        <MenuBarExtra.Section title={label}>
          {/* The dropdown re-reads on open, so this line is current whenever
              it is on screen — the menu bar title only moves on the interval. */}
          <MenuBarExtra.Item
            title={`Running for ${formatDurationShort(elapsed)}`}
            subtitle={`since ${formatClock(running.start)}`}
            icon={Icon.Dot}
            onAction={openTimer}
          />
          {entryHint(running) ? (
            <MenuBarExtra.Item
              title={entryHint(running) ?? ""}
              icon={Icon.Folder}
              onAction={openTimer}
            />
          ) : null}
          <MenuBarExtra.Item
            title="Stop Timer"
            icon={Icon.Stop}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
            onAction={() => {
              void act(async () => {
                const api = await getTracktime();
                const stopped = await api.stop();
                await showToast({
                  style: Toast.Style.Success,
                  title: "Timer stopped",
                  message: formatDurationShort(stopped.durationSec),
                });
              }, "Could not stop the timer");
            }}
          />
          {/* A menu bar item cannot host a form, so editing hands off to the
              Timer command, which opens on the running entry. */}
          <MenuBarExtra.Item
            title="Edit Timer…"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            onAction={openTimer}
          />
          <MenuBarExtra.Submenu title="Move to Project" icon={Icon.Folder}>
            {projects.map((project) => (
              <MenuBarExtra.Item
                key={project.id}
                title={project.name}
                subtitle={project.clientName ?? undefined}
                icon={{ source: Icon.CircleFilled, tintColor: project.color }}
                onAction={() => fileUnder(running, project)}
              />
            ))}
            <MenuBarExtra.Item
              title="No Project"
              icon={Icon.Circle}
              onAction={() => fileUnder(running, null)}
            />
          </MenuBarExtra.Submenu>
          <MenuBarExtra.Item
            title={pinned ? "Remove Favorite" : "Pin as Favorite"}
            icon={pinned ? Icon.StarDisabled : Icon.Star}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
            onAction={() => {
              void act(async () => {
                const api = await getTracktime();
                if (pinned) {
                  await api.removeFavorite(pinned.id);
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Favorite removed",
                  });
                  return;
                }
                await api.addFavorite(toQuickStart(running));
                await showToast({
                  style: Toast.Style.Success,
                  title: "Pinned as a favorite",
                });
              }, "Could not update favorites");
            }}
          />
          <MenuBarExtra.Item
            title="Discard Timer"
            icon={Icon.Trash}
            shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
            onAction={() => {
              void act(async () => {
                const api = await getTracktime();
                await api.discard();
                await showToast({
                  style: Toast.Style.Success,
                  title: "Timer discarded",
                });
              }, "Could not discard the timer");
            }}
          />
        </MenuBarExtra.Section>
      ) : (
        <MenuBarExtra.Section title="No timer running">
          <MenuBarExtra.Item
            title="Start Timer…"
            icon={Icon.Play}
            shortcut={{ modifiers: ["cmd"], key: "n" }}
            onAction={openTimer}
          />
        </MenuBarExtra.Section>
      )}

      {/* Pins first, and above Continue: they are the whole point of pinning.
          Started through `startQuick`, which is `entries.start` with the
          favorite's own fields — the same path every other client uses. */}
      {favorites.length > 0 ? (
        <MenuBarExtra.Section title="Favorites">
          {favorites.map((favorite) => (
            <MenuBarExtra.Item
              key={favorite.id}
              title={quickStartLabel(favorite)}
              subtitle={quickStartHint(favorite) ?? undefined}
              icon={Icon.Star}
              onAction={() => {
                void act(async () => {
                  const api = await getTracktime();
                  await api.startQuick(repairQuickStart(favorite));
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Timer started",
                    message: quickStartLabel(favorite),
                  });
                }, "Could not start the timer");
              }}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      {data && data.recent.length > 0 ? (
        <MenuBarExtra.Section title="Continue">
          {data.recent.map((entry) => (
            <MenuBarExtra.Item
              key={entry.id}
              title={entryLabel(entry)}
              subtitle={entry.projectName ?? undefined}
              icon={Icon.ArrowClockwise}
              onAction={() => {
                void act(async () => {
                  const api = await getTracktime();
                  await api.continue(entry.id);
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Timer started",
                    message: entryLabel(entry),
                  });
                }, "Could not start the timer");
              }}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      <MenuBarExtra.Section
        title={`Today · ${formatDurationShort(data?.todaySec ?? 0)}`}
      >
        <MenuBarExtra.Item
          title="Timer…"
          icon={Icon.Stopwatch}
          shortcut={{ modifiers: ["cmd"], key: "t" }}
          onAction={openTimer}
        />
        <MenuBarExtra.Item
          title="Show All Time…"
          icon={Icon.List}
          onAction={() => {
            void launchCommand({
              name: "entries",
              type: LaunchType.UserInitiated,
            });
          }}
        />
        <MenuBarExtra.Item
          title="Open Dashboard"
          icon={Icon.Globe}
          onAction={() => {
            void open(webLink("/track"));
          }}
        />
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
          onAction={revalidate}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
