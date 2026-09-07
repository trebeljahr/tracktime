/*
 * Capacitor (native-mobile) bridge.
 *
 * Loaded dynamically from the client entry so Capacitor symbols stay
 * out of the web bundle. Init is idempotent and all native calls are
 * try-wrapped — a missing plugin or denied permission never crashes
 * the web view.
 */

import type { StatusBar as StatusBarPlugin, Style as StyleEnum } from "@capacitor/status-bar";

export interface MobileHandlers {
  onBackButton?: () => boolean;
  onPause?: () => void;
  onResume?: () => void;
}

let initialized = false;

/** Light glyphs on a dark app, dark glyphs on a light one. */
function applyStatusBarStyle(
  StatusBar: typeof StatusBarPlugin,
  Style: typeof StyleEnum,
): void {
  const dark = document.documentElement.classList.contains("dark");
  // Capacitor names these for the CONTENT they produce, not the background:
  // `Style.Dark` is light text, for a dark app.
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(
    () => {
      /* ignore — a status bar that keeps its old style is cosmetic */
    },
  );
}

export async function initMobile(handlers: MobileHandlers = {}): Promise<void> {
  if (initialized) return;
  initialized = true;

  const [{ Capacitor }, { App }, { StatusBar, Style }] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/app"),
    import("@capacitor/status-bar"),
  ]);

  if (!Capacitor.isNativePlatform()) return;

  // app/layout.tsx already did both of these before the first paint — every
  // `body.cap` rule in styles/native.css has to be in force by then or the
  // app lays out once without the safe-area insets and jumps. These stay as
  // the idempotent backstop for the case where that script did not run.
  document.body.classList.add("cap");
  document.body.setAttribute("data-platform", Capacitor.getPlatform());

  // `viewportFit: "cover"` means the WebView reaches under the status bar,
  // so the status bar has no background of its own any more — it sits on top
  // of the app header, and native.css pads the header to leave room. Without
  // overlay the OS reserves an opaque strip in its own colour, which is a
  // white band above a dark header.
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* Android-only on some versions; iOS overlays regardless. */
  }

  applyStatusBarStyle(StatusBar, Style);

  // Style.Default asks the OS to choose, and the OS chooses from the SYSTEM
  // appearance — so a phone in light mode running the app in dark mode gets
  // dark glyphs on a near-black header, i.e. an invisible clock. The theme
  // lives in a class on <html> (app/layout.tsx's pre-paint script and
  // components/theme-toggle.tsx), so follow that instead.
  new MutationObserver(() => {
    applyStatusBarStyle(StatusBar, Style);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  if (handlers.onBackButton) {
    App.addListener("backButton", (event) => {
      const handled = handlers.onBackButton!();
      if (!handled && event.canGoBack === false) {
        App.exitApp();
      }
    });
  }

  if (handlers.onPause || handlers.onResume) {
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) handlers.onResume?.();
      else handlers.onPause?.();
    });
  }
}

export async function hideSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch {
    /* ignore */
  }
}

export async function lockOrientation(
  orientation: "portrait" | "landscape",
): Promise<void> {
  try {
    const { ScreenOrientation } = await import(
      "@capacitor/screen-orientation"
    );
    await ScreenOrientation.lock({ orientation });
  } catch {
    /* some devices refuse — leave unlocked */
  }
}

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}
