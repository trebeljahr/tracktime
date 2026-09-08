"use client";

import * as React from "react";

/**
 * The pointer the platform considers primary is imprecise — a finger, in
 * practice. Not a viewport width: a narrow desktop window is still a mouse,
 * and a 12.9" tablet is still a finger.
 */
const COARSE_QUERY = "(pointer: coarse)";

/**
 * One MediaQueryList for every caller. `matchMedia` is cheap but not free,
 * and the grid asks for this flag once per render pass.
 */
let list: MediaQueryList | null = null;

const query = (): MediaQueryList | null => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  list ??= window.matchMedia(COARSE_QUERY);
  return list;
};

const subscribe = (onChange: () => void): (() => void) => {
  const media = query();
  if (!media) return () => {};
  // `addEventListener` on a MediaQueryList is Safari 14+; `addListener` is the
  // deprecated fallback every older WebKit still ships.
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }
  media.addListener(onChange);
  return () => {
    media.removeListener(onChange);
  };
};

const getSnapshot = (): boolean => query()?.matches ?? false;

/**
 * Server and first-hydration answer. It has to be the *desktop* answer, or the
 * markup React renders on the client would not match the prerendered HTML —
 * the static export has no request to sniff. The real value arrives in the
 * commit right after, which is a re-render, never a hydration error.
 */
const getServerSnapshot = (): boolean => false;

/** True while the primary pointer is coarse (touch). */
export function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
