"use client";

import * as React from "react";
import { Timer } from "lucide-react";
import type { DetailedEntry } from "@starter/shared";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { EntryEditDialog } from "@/components/tracker/entry-edit-dialog";
import { EntryRow } from "@/components/tracker/entry-row";
import {
  dayHeadingLabel,
  groupEntriesByDay,
  type DayGroup,
} from "@/components/tracker/grouping";
import { LiveDuration } from "@/components/tracker/live-duration";
import {
  TRACKER_LIST_INPUT,
  useEntryMutations,
} from "@/components/tracker/use-entry-mutations";
import { useQuickStarts } from "@/hooks/use-favorites";
import { useFormatSettings } from "@/lib/format";
import { trpc } from "@/lib/trpc";

function EntrySkeletons(): React.JSX.Element {
  return (
    <div className="space-y-4" data-testid="entry-list-skeleton">
      {[0, 1, 2].map((group) => (
        <div key={group} className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DayHeader({ group }: { group: DayGroup }): React.JSX.Element {
  const format = useFormatSettings();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium" data-testid="day-label">
        {dayHeadingLabel(group.date)}
      </span>
      <span className="flex items-center gap-4 text-sm">
        {group.amount > 0 ? (
          <span className="text-muted-foreground" data-testid="day-amount">
            {format.money(group.amount)}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Total</span>
          <LiveDuration
            baseSec={group.totalSec}
            matchDate={group.date}
            className="text-sm font-medium"
            testId="day-total"
          />
        </span>
      </span>
    </div>
  );
}

/**
 * The day-grouped log under the tracker bar. Pages through history with the
 * server cursor, collapses look-alike runs, and keeps every field editable in
 * place.
 */
export function EntryList(): React.JSX.Element {
  const mutations = useEntryMutations();
  const quickStarts = useQuickStarts();
  const [editing, setEditing] = React.useState<DetailedEntry | null>(null);

  const query = trpc.entries.list.useInfiniteQuery(TRACKER_LIST_INPUT, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: true,
  });

  const entries = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.entries) ?? [],
    [query.data]
  );
  const days = React.useMemo(() => groupEntriesByDay(entries), [entries]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [fetchNextPage, hasNextPage, entries.length]);

  const handleEdit = React.useCallback((entry: DetailedEntry): void => {
    setEditing(entry);
  }, []);

  const closeEditor = React.useCallback((): void => {
    setEditing(null);
  }, []);

  if (query.isPending) return <EntrySkeletons />;

  if (query.isError) {
    return (
      <EmptyState
        icon={Timer}
        title="Could not load your entries"
        description={query.error.message}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
            data-testid="entries-retry"
          >
            Try again
          </Button>
        }
        testId="entries-error"
      />
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Timer}
        title="No time tracked yet"
        description="Type what you are working on above and hit Start — or press + to log time you already spent."
        testId="entries-empty"
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="entry-list">
      {days.map((day) => (
        <section
          key={day.date}
          className="overflow-hidden rounded-lg border border-border"
          data-testid="day-group"
          data-date={day.date}
        >
          <DayHeader group={day} />
          {day.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              mutations={mutations}
              quickStarts={quickStarts}
              onEdit={handleEdit}
            />
          ))}
        </section>
      ))}

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            data-testid="entries-load-more"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <EntryEditDialog
        entry={editing}
        onClose={closeEditor}
        mutations={mutations}
      />
    </div>
  );
}
