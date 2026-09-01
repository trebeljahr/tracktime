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
import { entryDurationSec, type DetailedEntry } from "@starter/core";
import { getTracktime } from "./lib/api.js";
import {
  formatDurationShort,
  formatMenuBarDuration,
  isoDaysAgo,
} from "./lib/format.js";
import { useApi } from "./lib/hooks.js";
import { webLink } from "./lib/preferences.js";
import { showFailureToast } from "./lib/ui.js";

/** How far back the "continue" shortlist looks. */
const RECENT_DAYS = 7;
const RECENT_LIMIT = 6;

type MenuData = {
  running: DetailedEntry | null;
  recent: DetailedEntry[];
  todaySec: number;
};

const startOfToday = (): number => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/**
 * Distinct recent work, newest first — what the user would plausibly resume.
 * Two entries that share a description, project and task are the same job
 * done twice, so only the newest of them earns a slot.
 */
const shortlist = (entries: DetailedEntry[]): DetailedEntry[] => {
  const seen = new Set<string>();
  const out: DetailedEntry[] = [];

  for (const entry of entries) {
    if (entry.end === null) continue;
    const key = `${entry.description}|${entry.projectId ?? ""}|${entry.taskId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length === RECENT_LIMIT) break;
  }

  return out;
};

const load = async (): Promise<MenuData> => {
  const api = await getTracktime();
  const now = Date.now();

  // One round trip: the running entry is in this window too, and it arrives
  // with its project and client names already joined.
  const { entries } = await api.list({
    from: isoDaysAgo(RECENT_DAYS),
    to: new Date(now + 60_000).toISOString(),
    limit: 100,
  });

  const dayStart = startOfToday();
  const todaySec = entries.reduce((total, entry) => {
    const startMs = Date.parse(entry.start);
    if (!Number.isFinite(startMs) || startMs < dayStart) return total;
    return total + entryDurationSec(entry, now);
  }, 0);

  return {
    running: entries.find((entry) => entry.end === null) ?? null,
    recent: shortlist(entries),
    todaySec,
  };
};

const entryLabel = (entry: DetailedEntry): string =>
  entry.description.trim() || entry.projectName || "No description";

export default function MenuBar(): React.JSX.Element | null {
  const { titleMode, hideWhenIdle } =
    getPreferenceValues<Preferences.MenuBar>();
  const { data, isLoading, signedOut, revalidate } = useApi("menu-bar", load);

  if (signedOut) {
    return (
      <MenuBarExtra icon={Icon.Stopwatch} tooltip="tracktime — not signed in">
        <MenuBarExtra.Item
          title="Sign in to tracktime"
          icon={Icon.Key}
          onAction={() => {
            void launchCommand({
              name: "sign-in",
              type: LaunchType.UserInitiated,
            });
          }}
        />
      </MenuBarExtra>
    );
  }

  const running = data?.running ?? null;
  if (!running && !isLoading && hideWhenIdle) return null;

  const elapsed = running ? entryDurationSec(running, Date.now()) : 0;
  const clock = formatMenuBarDuration(elapsed);
  const label = running ? entryLabel(running) : "";

  const title = ((): string | undefined => {
    if (!running || titleMode === "icon") return undefined;
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

  return (
    <MenuBarExtra
      icon={running ? Icon.Stopwatch : Icon.Clock}
      title={title}
      isLoading={isLoading}
      tooltip={running ? `${label} — ${clock}` : "tracktime — no timer running"}
    >
      {running ? (
        <MenuBarExtra.Section title={label}>
          <MenuBarExtra.Item
            title={`Running for ${formatDurationShort(elapsed)}`}
            subtitle={running.projectName ?? undefined}
            icon={Icon.Dot}
            onAction={() => {
              void open(webLink("/track"));
            }}
          />
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
            onAction={() => {
              void launchCommand({
                name: "start-timer",
                type: LaunchType.UserInitiated,
              });
            }}
          />
        </MenuBarExtra.Section>
      )}

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
          title="Time Entries…"
          icon={Icon.List}
          onAction={() => {
            void launchCommand({
              name: "entries",
              type: LaunchType.UserInitiated,
            });
          }}
        />
        <MenuBarExtra.Item
          title="Open Web App"
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
