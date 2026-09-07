import { dismissTopOverlay } from "@/mobile/overlay-stack";

/** Where the hardware back button comes to rest before it exits the app. */
export const ROOT_TAB = "/track";

export type BackButtonDeps = {
  pathname: string;
  navigate: (href: string) => void;
  /** Injected so the decision can be tested without a live overlay stack. */
  dismissOverlay?: () => boolean;
};

/**
 * Android's hardware back button, in priority order:
 *
 *   1. an open overlay — dialog, drawer, sheet — closes;
 *   2. anywhere but the root tab goes to the root tab;
 *   3. at the root there is nothing left, so `false` asks the shell to exit.
 *
 * Step 2 navigates rather than calling `router.back()`. History here is
 * whatever the user has browsed, so `back()` from three screens deep walks
 * backwards through them one at a time instead of returning to Track, and a
 * WebView reload always lands on `/` anyway — which makes the entries that
 * survive a reload not the ones the user would expect. Root-tab-then-exit is
 * the platform convention and it is the one that can be reasoned about.
 *
 * Returns whether the app consumed the press; `false` means exit.
 */
export function handleBackPress({
  pathname,
  navigate,
  dismissOverlay = dismissTopOverlay,
}: BackButtonDeps): boolean {
  if (dismissOverlay()) return true;
  if (pathname === ROOT_TAB || pathname.startsWith(`${ROOT_TAB}/`)) return false;
  navigate(ROOT_TAB);
  return true;
}
