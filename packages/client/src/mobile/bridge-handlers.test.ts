// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The handler table and the back button contract, with the Capacitor plugins
 * faked.
 *
 * What this file guards is the bug the critics found: handlers used to be
 * arguments to `initMobile`, which latches on its first call — and that first
 * call is MobileBridgeLoader at the app root, with no arguments at all. Every
 * handler AppShell registered afterwards was dropped in silence: no error, no
 * warning, just a back button that exits from every screen and a resume that
 * never reconnects. Worse, the listeners themselves were only added when a
 * handler was already present, so there was nothing to fix later.
 */

type Listener = (event: never) => void;

const listeners = new Map<string, Listener>();
const exitApp = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (name: string, listener: Listener) => {
      listeners.set(name, listener);
      return { remove: () => listeners.delete(name) };
    },
    exitApp: () => exitApp(),
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: () => Promise.resolve(),
    setOverlaysWebView: () => Promise.resolve(),
  },
  Style: { Dark: "DARK", Light: "LIGHT" },
}));

type Bridge = typeof import("./bridge");

const back = (canGoBack: boolean): void => {
  const listener = listeners.get("backButton");
  if (!listener) throw new Error("no backButton listener was registered");
  (listener as (event: { canGoBack: boolean }) => void)({ canGoBack });
};

const resume = (isActive: boolean): void => {
  const listener = listeners.get("appStateChange");
  if (!listener) throw new Error("no appStateChange listener was registered");
  (listener as (event: { isActive: boolean }) => void)({ isActive });
};

let bridge: Bridge;

beforeEach(async () => {
  listeners.clear();
  exitApp.mockClear();
  vi.resetModules();
  bridge = await import("./bridge");
  // Exactly what MobileBridgeLoader does at the app root, before AppShell
  // has rendered even once.
  await bridge.initMobile();
});

describe("initMobile", () => {
  it("registers both listeners even with no handlers at all", () => {
    expect(listeners.has("backButton")).toBe(true);
    expect(listeners.has("appStateChange")).toBe(true);
  });
});

describe("the hardware back button", () => {
  it("runs a handler registered long after the latch closed", () => {
    const onBackButton = vi.fn(() => true);
    bridge.setMobileHandlers({ onBackButton });

    back(false);
    expect(onBackButton).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("exits when the handler declines, even with history to go back to", () => {
    // The old contract exited only when `canGoBack === false`. A single-page
    // app accumulates history entries simply by moving between tabs, so at
    // the root of the app the button did nothing at all.
    bridge.setMobileHandlers({ onBackButton: () => false });

    back(true);
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("falls back to history when no handler is registered", () => {
    // The sign-in screen is outside AppShell, so nothing owns the button
    // there.
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(
      () => undefined,
    );

    back(true);
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();

    back(false);
    expect(exitApp).toHaveBeenCalledTimes(1);
    historyBack.mockRestore();
  });
});

describe("setMobileHandlers", () => {
  it("merges rather than replaces, so two owners can coexist", () => {
    const onResume = vi.fn();
    bridge.setMobileHandlers({ onResume });
    bridge.setMobileHandlers({ onBackButton: () => true });

    resume(true);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("teardown clears only the exact functions it installed", () => {
    // A React effect re-running can install the new handler before the old
    // effect's cleanup runs. A stale teardown must not erase the live one.
    const teardown = bridge.setMobileHandlers({ onBackButton: () => false });
    const second = vi.fn(() => true);
    bridge.setMobileHandlers({ onBackButton: second });
    teardown();

    back(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("teardown removes the handler when it is still the current one", () => {
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(
      () => undefined,
    );
    bridge.setMobileHandlers({ onBackButton: () => true })();

    back(true);
    expect(historyBack).toHaveBeenCalledTimes(1);
    historyBack.mockRestore();
  });
});
