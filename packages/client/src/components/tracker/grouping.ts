import { sumAmounts, toLocalDateKey, type DetailedEntry } from "@starter/shared";

/**
 * Consecutive entries sharing a description and a project. time tracker collapses
 * these because a day of pomodoro-sized blocks on one task is otherwise a wall
 * of near-identical rows.
 */
export type EntryCluster = {
  key: string;
  entries: DetailedEntry[];
  totalSec: number;
  amount: number;
};

export type DayGroup = {
  /** Local "YYYY-MM-DD". */
  date: string;
  clusters: EntryCluster[];
  entryCount: number;
  /** Finished seconds only — the running entry is added live by the header. */
  totalSec: number;
  billableSec: number;
  amount: number;
};

const clusterKey = (entry: DetailedEntry): string =>
  `${entry.description.trim().toLowerCase()}::${entry.projectId ?? ""}`;

/**
 * Bucket entries (already sorted newest first) into days, then collapse
 * consecutive look-alikes inside each day.
 *
 * A running entry never joins a cluster: it has to stay individually
 * addressable so its row can tick and be stopped.
 */
export const groupEntriesByDay = (entries: DetailedEntry[]): DayGroup[] => {
  const days: DayGroup[] = [];
  let currentDay: DayGroup | null = null;
  let currentCluster: EntryCluster | null = null;

  for (const entry of entries) {
    const date = toLocalDateKey(new Date(entry.start));

    if (currentDay === null || currentDay.date !== date) {
      currentDay = {
        date,
        clusters: [],
        entryCount: 0,
        totalSec: 0,
        billableSec: 0,
        amount: 0,
      };
      days.push(currentDay);
      currentCluster = null;
    }

    const running = entry.end === null;
    const key = clusterKey(entry);

    if (
      currentCluster === null ||
      running ||
      currentCluster.key !== key ||
      currentCluster.entries.some((member) => member.end === null)
    ) {
      currentCluster = { key, entries: [], totalSec: 0, amount: 0 };
      currentDay.clusters.push(currentCluster);
    }

    currentCluster.entries.push(entry);
    currentCluster.totalSec += entry.durationSec;
    currentDay.entryCount += 1;
    currentDay.totalSec += entry.durationSec;
    if (entry.billable) currentDay.billableSec += entry.durationSec;
  }

  for (const day of days) {
    for (const cluster of day.clusters) {
      cluster.amount = sumAmounts(cluster.entries.map((entry) => entry.amount));
    }
    day.amount = sumAmounts(day.clusters.map((cluster) => cluster.amount));
  }

  return days;
};

/** "Today" / "Yesterday" / "Fri, 21 Aug" for a local date key. */
export const dayHeadingLabel = (
  dateKey: string,
  now: Date = new Date()
): string => {
  const today = toLocalDateKey(now);
  if (dateKey === today) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === toLocalDateKey(yesterday)) return "Yesterday";

  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year:
      parsed.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
};
