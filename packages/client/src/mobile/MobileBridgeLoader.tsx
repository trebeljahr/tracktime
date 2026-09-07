"use client";

import { useEffect } from "react";

import { hydrateNativeSession } from "@/lib/native-session";
import { seedRunningFromMirror } from "@/lib/running-mirror";
import { timerStore } from "@/hooks/use-sync";
import { startNetworkWatch } from "@/mobile/network";

/*
 * Mounts once at app root. If running under Capacitor (iOS/Android
 * WebView), imports the bridge and initializes plugins. On web this
 * module still loads but initMobile() short-circuits when
 * Capacitor.isNativePlatform() returns false, so it's a no-op.
 */
export function MobileBridgeLoader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Kicked off here because this component is the first thing the root
    // layout renders, so the Keychain read is already in flight by the time
    // the protected layout mounts and asks whether the user is signed in. It
    // is idempotent and resolves immediately on web, where it only flips the
    // "ready" flag every consumer waits on.
    void hydrateNativeSession();

    // Both of these belong at the app root rather than in the shell: the
    // network verdict is read by `isNetworkError()` on every failed mutation,
    // including ones made on /login, and the running-timer seed has to be in
    // the store before the first screen asks what is running.
    startNetworkWatch();
    void seedRunningFromMirror(timerStore);

    const cap = (window as unknown as { Capacitor?: unknown }).Capacitor;
    if (!cap) return;

    let cancelled = false;
    (async () => {
      const { initMobile, hideSplash } = await import("./bridge");
      if (cancelled) return;
      await initMobile();
      await hideSplash();
    })().catch(() => {
      /* swallow — bridge failures must never crash the app */
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
