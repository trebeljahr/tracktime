"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Pin, PinOff, Play, Zap } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BillableGlyph } from "@/components/tracker/billable-glyph";
import type { EntryMutations } from "@/components/tracker/use-entry-mutations";
import { useQuickStarts } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";

/**
 * One row of the quick-start menu. Selecting it starts a timer; the trailing
 * controls pin, unpin and reorder without closing the menu.
 *
 * A quick start whose project was deleted is still startable — its description
 * is the part the user typed, and `repairQuickStart` drops the dangling
 * reference rather than sending the server an id it will reject. The row says
 * so, so the start is not a silent downgrade.
 */
function QuickStartMenuItem({
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

  // Radix selects an item on click; a click that never reaches it neither
  // starts a timer nor closes the menu, which is exactly what pinning and
  // reordering want.
  const swallow = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <DropdownMenuItem
      className="group gap-2 py-2"
      onSelect={() => onStart(item)}
      data-testid="quick-start-item"
      data-kind={item.kind}
      data-broken={broken ? "true" : "false"}
    >
      {item.projectColor === null ? (
        <Play className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: item.projectColor }}
        />
      )}

      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {hint === null ? null : (
          <span
            className={cn(
              "truncate text-xs text-muted-foreground",
              broken && "text-destructive"
            )}
            data-testid="quick-start-hint"
          >
            {hint}
          </span>
        )}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Chip-sized rather than the glyph's own icon size — the wrapper
            scales it because BillableGlyph follows the currency setting and
            takes no class of its own. */}
        {item.billable ? (
          <span
            className="mr-1 shrink-0 text-muted-foreground [&_svg]:size-3"
            title="Billable"
            data-testid="quick-start-billable"
          >
            <BillableGlyph billable />
          </span>
        ) : null}

        {pinned ? (
          <>
            <button
              type="button"
              disabled={index === 0}
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-0 group-hover:opacity-100 group-data-[highlighted]:opacity-100 focus-visible:opacity-100"
              aria-label={`Move ${label} up`}
              onClick={(event) => {
                swallow(event);
                onMove(item.id, -1);
              }}
              data-testid="quick-start-move-up"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={index >= favoriteCount - 1}
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-0 group-hover:opacity-100 group-data-[highlighted]:opacity-100 focus-visible:opacity-100"
              aria-label={`Move ${label} down`}
              onClick={(event) => {
                swallow(event);
                onMove(item.id, 1);
              }}
              data-testid="quick-start-move-down"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Unpin ${label}`}
              title="Unpin"
              onClick={(event) => {
                swallow(event);
                onUnpin(item.id);
              }}
              data-testid="quick-start-unpin"
            >
              <PinOff className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100 group-data-[highlighted]:opacity-100 focus-visible:opacity-100"
            aria-label={`Pin ${label}`}
            title="Pin to the top of this menu"
            onClick={(event) => {
              swallow(event);
              onPin(item);
            }}
            data-testid="quick-start-pin"
          >
            <Pin className="size-3.5" />
          </button>
        )}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The tracker bar's "Quick start" menu: the handful of things this person
 * actually tracks, two clicks from running.
 *
 * It used to be a rail of chips above the composer. That rail was always on
 * screen, said nothing about what it was, and pushed the one field the bar is
 * really about down the page. A single labelled button costs one extra click
 * and buys back the top of the screen — and inside the menu there is room to
 * say which rows are pinned and which are simply recent, which the chips never
 * could.
 */
export function QuickStartMenu({
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

  const favorites = React.useMemo(
    () => quickStarts.items.filter((item) => item.kind === "favorite"),
    [quickStarts.items]
  );
  const recents = React.useMemo(
    () => quickStarts.items.filter((item) => item.kind === "recent"),
    [quickStarts.items]
  );

  // Nothing tracked yet and nothing pinned: an empty menu would be a button
  // that explains itself and does nothing, so it simply is not there.
  if (quickStarts.isLoading || quickStarts.items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-10 shrink-0 gap-1.5 px-2 text-muted-foreground"
          aria-label="Quick start"
          title="Start something you tracked before"
          data-testid="quick-start-trigger"
        >
          <Zap className="size-4" />
          <span className="hidden sm:inline">Quick start</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] w-80 overflow-y-auto"
        data-testid="quick-start-menu"
      >
        {favorites.length > 0 ? (
          <>
            <DropdownMenuLabel>Favorites</DropdownMenuLabel>
            {favorites.map((item, index) => (
              <QuickStartMenuItem
                key={item.id}
                item={item}
                index={index}
                favoriteCount={favorites.length}
                onStart={start}
                onPin={pin}
                onUnpin={quickStarts.unpin}
                onMove={quickStarts.move}
              />
            ))}
          </>
        ) : null}

        {favorites.length > 0 && recents.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}

        {recents.length > 0 ? (
          <>
            <DropdownMenuLabel>Recently tracked</DropdownMenuLabel>
            {recents.map((item) => (
              <QuickStartMenuItem
                key={item.key}
                item={item}
                index={0}
                favoriteCount={favorites.length}
                onStart={start}
                onPin={pin}
                onUnpin={quickStarts.unpin}
                onMove={quickStarts.move}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
