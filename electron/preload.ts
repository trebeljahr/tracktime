/*
 * Electron preload — exposes a narrow window.electronAPI to the renderer.
 *
 * Any renderer code that uses this API should guard against it being
 * undefined so the same build also runs in the browser / PWA:
 *   const api = (window as any).electronAPI;
 *   if (api?.isDesktop) { ... }
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,

  quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),

  setFullscreen: (on: boolean): Promise<boolean> =>
    ipcRenderer.invoke("window:setFullscreen", on),
  isFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke("window:isFullscreen"),

  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("app:openExternal", url),

  /** The OS idle counter, which sees every app — not just this window. */
  getIdleState: (): Promise<{ state: string; idleSeconds: number }> =>
    ipcRenderer.invoke("idle:get"),

  /**
   * Subscribe to idle/lock changes. Returns an unsubscribe function; the
   * listener is wrapped so the renderer never receives the IpcRendererEvent,
   * which would leak `sender` across the context bridge.
   */
  onIdleState: (
    listener: (payload: { state: string; idleSeconds: number }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { state: string; idleSeconds: number },
    ): void => listener(payload);
    ipcRenderer.on("idle:state", handler);
    return () => {
      ipcRenderer.removeListener("idle:state", handler);
    };
  },
});
