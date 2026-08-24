"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import type { DetailedEntry } from "@starter/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntryRow } from "@/components/tracker/entry-row";
import type { EntryCluster } from "@/components/tracker/grouping";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { useFormatSettings } from "@/lib/format";

export type EntryGroupProps = {
  cluster: EntryCluster;
  mutations: EntryMutations;
  onEdit: (entry: DetailedEntry) => void;
};

/**
 * A run of look-alike entries, collapsed into one row with a count badge and
 * the combined duration. Expanding reveals the individual blocks, each fully
 * editable.
 */
export function EntryGroup({
  cluster,
  mutations,
  onEdit,
}: EntryGroupProps): React.JSX.Element {
  const format = useFormatSettings();
  const [expanded, setExpanded] = React.useState(false);

  const first = cluster.entries[0];
  if (cluster.entries.length === 1 && first !== undefined) {
    return <EntryRow entry={first} mutations={mutations} onEdit={onEdit} />;
  }
  if (first === undefined) return <></>;

  return (
    <div data-testid="entry-group" data-count={cluster.entries.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 hover:bg-muted/40">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse group" : "Expand group"}
          onClick={() => setExpanded((current) => !current)}
          data-testid="entry-group-toggle"
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>

        <Badge variant="secondary" data-testid="entry-group-count">
          {cluster.entries.length}
        </Badge>

        <span
          className="min-w-0 flex-1 basis-56 truncate px-2 text-sm"
          data-testid="entry-group-description"
        >
          {first.description.trim() === ""
            ? "No description"
            : first.description}
        </span>

        {first.projectName !== null ? (
          <span className="flex max-w-48 items-center gap-2 truncate text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: first.projectColor ?? undefined }}
            />
            <span className="truncate">{first.projectName}</span>
          </span>
        ) : null}

        <span
          className="ml-auto w-24 text-right font-mono text-sm tabular-nums"
          data-testid="entry-group-duration"
        >
          {format.duration(cluster.totalSec)}
        </span>

        <span className="hidden w-20 text-right text-sm text-muted-foreground tabular-nums sm:inline">
          {cluster.amount > 0 ? format.money(cluster.amount) : ""}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-primary"
          aria-label="Continue this entry"
          onClick={() => mutations.continueEntry(first)}
          data-testid="entry-group-continue"
        >
          <Play />
        </Button>

        <span className="size-8" aria-hidden="true" />
      </div>

      {expanded
        ? cluster.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              mutations={mutations}
              onEdit={onEdit}
              nested
            />
          ))
        : null}
    </div>
  );
}
