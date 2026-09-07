"use client";

import * as React from "react";

import {
  getNativeSession,
  getServerNativeSession,
  hydrateNativeSession,
  subscribeNativeSession,
  type NativeSession,
} from "@/lib/native-session";

/**
 * The native bearer token and whether it has finished loading.
 *
 * Kicks hydration off on first mount — it is idempotent, so every consumer
 * can call this hook without coordinating. Note what this hook deliberately
 * does NOT do: it never changes what is rendered while hydration is in
 * flight. Under `output: "export"` the served HTML is prerendered in Node
 * where there is no Capacitor, so a component that returned `null` until the
 * Keychain answered would hand React a different tree than the markup it is
 * hydrating and force the whole subtree to be re-rendered from scratch —
 * behind a splash screen configured never to auto-hide. Consumers wait on
 * `ready` inside effects instead.
 */
export const useNativeSession = (): NativeSession => {
  const session = React.useSyncExternalStore(
    subscribeNativeSession,
    getNativeSession,
    getServerNativeSession,
  );

  // After the store subscription, not before: on web `hydrateNativeSession()`
  // flips `ready` synchronously, and an effect ordered ahead of the
  // subscription would publish that change into an empty listener set.
  React.useEffect(() => {
    void hydrateNativeSession();
  }, []);

  return session;
};
