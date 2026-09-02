/*
 * Type definitions for the Electron preload bridge.
 *
 * The preload script in electron/preload.ts exposes window.electronAPI
 * with these methods. Guard every usage — the same build also runs in
 * the browser / PWA where window.electronAPI is undefined.
 */

export interface ElectronAPI {
  isDesktop: true;
  quit: () => Promise<void>;
  setFullscreen: (on: boolean) => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;

  /**
   * OS-level idle, which sees input in every application — a renderer only
   * sees its own. Absent in older shells, so callers must guard on it.
   */
  getIdleState?: () => Promise<DesktopIdlePayload>;
  onIdleState?: (listener: (payload: DesktopIdlePayload) => void) => () => void;
}

/** What electron/main.ts reports about the machine's idleness. */
export interface DesktopIdlePayload {
  /** "active" | "idle" | "locked" — widened because it crosses IPC. */
  state: string;
  /** Seconds since the OS last saw any input. */
  idleSeconds: number;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
