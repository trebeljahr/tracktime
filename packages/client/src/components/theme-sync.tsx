"use client";

import * as React from "react";

import { ORIGIN_ID } from "@/hooks/use-sync";
import {
  adoptTheme,
  setThemeSink,
  THEME_STORAGE_KEY,
  THEME_SYNCED_KEY,
  type ThemeChoice,
} from "@/components/theme-toggle";
import { trpc } from "@/lib/trpc";

/**
 * Keeps the theme in step with the server, in both directions.
 *
 * The theme used to live in this browser's `localStorage` alone, which meant
 * the extension rendering beside this app had no way to know a dark theme had
 * been chosen: every client fell back to `prefers-color-scheme`, and the two
 * disagreed on any machine where the choice was not the OS one. It is a stored
 * user preference now, so it travels — while `localStorage` stays as the local
 * copy the no-flash script paints from before any query has answered.
 *
 * Renders nothing, and is mounted exactly once, in the app shell: the theme
 * store it drives is a module-level singleton and a second registration would
 * be a second writer for one value.
 */

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "light" || value === "dark" || value === "system";

/** The stored choice, read directly — `useTheme` would need a render to report it. */
const readLocalChoice = (): ThemeChoice | null => {
  try {
    const stored: unknown = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : null;
  } catch {
    return null;
  }
};

/** True once this browser's stored choice has been reconciled with the server. */
const hasSynced = (): boolean => {
  try {
    return window.localStorage.getItem(THEME_SYNCED_KEY) === "1";
  } catch {
    // Storage is unreadable, so nothing survives a reload anyway. Treating it
    // as already synced makes the server's value win, which is where the
    // migration below lands on its second run regardless.
    return true;
  }
};

const markSynced = (): void => {
  try {
    window.localStorage.setItem(THEME_SYNCED_KEY, "1");
  } catch {
    /* private mode — the migration is simply considered again next load */
  }
};

export function ThemeSync(): null {
  const utils = trpc.useUtils();
  const query = trpc.settings.get.useQuery(undefined, { staleTime: 60_000 });
  const mutation = trpc.settings.update.useMutation({
    onSuccess: (updated) => {
      utils.settings.get.setData(undefined, updated);
    },
  });

  const { mutate } = mutation;

  /**
   * The choice this tab last sent and has not seen confirmed.
   *
   * `settings.get` may already have been in flight when the user picked a
   * theme, so its answer can describe the world before the click. Without this
   * the arriving snapshot would flip the page back for as long as the write
   * took.
   */
  const pending = React.useRef<ThemeChoice | null>(null);

  const push = React.useCallback(
    (choice: ThemeChoice): void => {
      pending.current = choice;
      mutate({ theme: choice, originId: ORIGIN_ID });
    },
    [mutate],
  );

  React.useEffect(() => {
    setThemeSink(push);
    return () => setThemeSink(null);
  }, [push]);

  const serverTheme = query.data?.theme;

  React.useEffect(() => {
    if (serverTheme === undefined) return;

    // A browser that chose a theme before it was ever synced holds the only
    // record of that choice, while the server sits on the default nobody
    // picked. Push rather than adopt, exactly once — otherwise switching this
    // on would silently reset every existing user to "system".
    if (!hasSynced()) {
      markSynced();
      const local = readLocalChoice();
      if (local !== null && local !== "system" && serverTheme === "system") {
        push(local);
        return;
      }
    }

    if (pending.current !== null && pending.current !== serverTheme) return;
    pending.current = null;
    adoptTheme(serverTheme);
  }, [serverTheme, push]);

  return null;
}
