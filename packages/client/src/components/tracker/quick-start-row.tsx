"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Pin,
  PinOff,
  Play,
} from "lucide-react";
import {
  isBrokenQuickStart,
  quickStartHint,
  quickStartLabel,
  repairQuickStart,
  type QuickStartItem,
} from "@starter/core";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { BillableGlyph } from "@/components/tracker/billable-glyph";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { useQuickStarts } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";

/**
 * One chip. Pressing it starts a timer; the menu pins, unpins and reorders.
 *
 * A quick start whose project was deleted is still startable — its description
 * is the part the user typed, and `repairQuickStart` drops the dangling
 * reference rather than sending the server an id it will reject. The chip says
 * so, so the start is not a silent downgrade.
 */
function QuickStartChip({
  item,
  index,
  favoriteCount,
  onStart,
  onPin,
  onUnpin,
  onMove,
}: {
  item: QuickStartItem;
  index: number;
  favoriteCount: number;
  onStart: (item: QuickStartItem) => void;
  onPin: (item: QuickStartItem) => void;
  onUnpin: (id: string) => void;
  onMove: (id: string, delta: number) => void;
}): React.JSX.Element {
  const pinned = item.kind === "favorite";
  const label = quickStartLabel(item);
  const hint = quickStartHint(item);
  const broken = isBrokenQuickStart(item);

  return (
    <div
      className={cn(
        "group flex shrink-0 items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-0.5 pl-2 text-sm",
        pinned && "border-primary/40"
      )}
      data-testid="quick-start-chip"
      data-kind={item.kind}
      data-broken={broken ? "true" : "false"}
    >
      <button
        type="button"
        className="flex min-w-0 max-w-56 items-center gap-1.5 py-1 text-left"
        onClick={() => onStart(item)}
        title={hint === null ? label : `${label} — ${hint}`}
        data-testid="quick-start-play"
      >
        {item.projectColor === null ? (
          <Play className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.projectColor }}
          />
        )}
        <span className="min-w-0 truncate">{label}</span>
        {hint === null ? null : (
          <span
            className={cn(
              "hidden min-w-0 shrink truncate text-xs text-muted-foreground md:inline",
              broken && "text-destructive"
            )}
            data-testid="quick-start-hint"
          >
            {hint}
          </span>
        )}
        {/* Chip-sized rather than the glyph's own icon size — the wrapper
            scales it because BillableGlyph follows the currency setting and
            takes no class of its own. */}
        {item.billable ? (
          <span
            className="shrink-0 [&_svg]:size-3"
            title="Billable"
            data-testid="quick-start-billable"
          >
            <BillableGlyph billable />
          </span>
        ) : null}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded-full"
            aria-label={`Options for ${label}`}
            data-testid="quick-start-menu"
          >
            <Ellipsis className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {pinned ? (
            <>
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => onMove(item.id, -1)}
                data-testid="quick-start-move-left"
              >
                <ChevronLeft /> Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index >= favoriteCount - 1}
                onSelect={() => onMove(item.id, 1)}
                data-testid="quick-start-move-right"
              >
                <ChevronRight /> Move right
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onUnpin(item.id)}
                data-testid="quick-start-unpin"
              >
                <PinOff /> Unpin
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              onSelect={() => onPin(item)}
              data-testid="quick-start-pin"
            >
              <Pin /> Pin to favorites
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The row above the tracker's fields: the handful of things this person
 * actually tracks, one click from running.
 *
 * Pinned favorites come first in the user's own order, then recents fill the
 * remaining slots — so the row is useful on day one, before anything has been
 * pinned, and stops drifting once something has been.
 */
export function QuickStartRow({
  mutations,
}: {
  mutations: EntryMutations;
}): React.JSX.Element | null {
  const quickStarts = useQuickStarts();

  const start = React.useCallback(
    (item: QuickStartItem): void => {
      mutations.startQuickStart(repairQuickStart(item));
    },
    [mutations]
  );

  const pin = React.useCallback(
    (item: QuickStartItem): void => {
      quickStarts.pin(repairQuickStart(item));
    },
    [quickStarts]
  );

  if (quickStarts.isLoading) {
    return (
      <div
        className="mb-2 flex items-center gap-2"
        data-testid="quick-start-row-skeleton"
      >
        {[0, 1, 2].map((slot) => (
          <Skeleton key={slot} className="h-7 w-32 rounded-full" />
        ))}
      </div>
    );
  }

  // Nothing tracked yet and nothing pinned: an empty rail would be a row of
  // furniture explaining itself, so it simply is not there.
  if (quickStarts.items.length === 0) return null;

  return (
    <div
      className="-mx-1 mb-2 flex items-center gap-2 overflow-x-auto px-1 pb-1"
      aria-label="Quick start"
      data-testid="quick-start-row"
    >
      {quickStarts.items.map((item, index) => (
        <QuickStartChip
          key={item.kind === "favorite" ? item.id : item.key}
          item={item}
          index={index}
          favoriteCount={quickStarts.favorites.length}
          onStart={start}
          onPin={pin}
          onUnpin={quickStarts.unpin}
          onMove={quickStarts.move}
        />
      ))}
    </div>
  );
}
