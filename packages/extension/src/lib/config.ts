/**
 * Where this extension talks to the server.
 *
 * A baked-in URL alone is not enough: `pnpm run dev` picks a random API port
 * per run, so a build from yesterday would point at a port nothing is
 * listening on. The build-time value is therefore only a default, and the
 * popup can override it at runtime into `chrome.storage.local`.
 */
import { resolveSyncUrl, type ClientId } from "@starter/core";
import { chromeStorage, localStorageArea } from "./chrome-storage";

/**
 * The origin this build targets, injected by vite.config.ts from the build
 * mode — localhost for a development build, the deployed host for production.
 *
 * There is deliberately no localhost fallback. A fallback cannot tell which
 * build it is standing in for, so a production build whose define went missing
 * would quietly ship pointing at a laptop, and present as "the extension is
 * broken" rather than as the build error it is. `import.meta.env` is loosely
 * typed by vite/client, so the value is still narrowed before it is trusted.
 */
const buildTimeApiUrl = ((): string => {
  const configured: unknown = import.meta.env.VITE_API_URL;
  if (typeof configured !== "string" || configured.trim() === "") {
    throw new Error(
      "No API URL was baked into this build — see `define` in vite.config.ts.",
    );
  }
  return configured.trim();
})();

export const DEFAULT_API_URL: string = buildTimeApiUrl;

export const API_URL_STORAGE_KEY = "tracktime.api-url";

/** Names this client in Settings → Devices, and to the device-flow allowlist. */
export const EXTENSION_CLIENT_ID: ClientId = "tracktime-extension";

const storage = (): ReturnType<typeof chromeStorage> =>
  chromeStorage(localStorageArea());

export async function loadApiUrl(): Promise<string> {
  const stored = await storage().getItem(API_URL_STORAGE_KEY);
  return stored !== null && stored.trim() !== "" ? stored : DEFAULT_API_URL;
}

/**
 * Persist an override. Validated first because a value that does not parse
 * bricks every later request with no obvious way back — the popup would keep
 * failing against a URL the user can no longer see was wrong.
 */
export async function saveApiUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  try {
    new URL(trimmed);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  await storage().setItem(API_URL_STORAGE_KEY, trimmed);
}

/**
 * The WebSocket URL for an API origin.
 *
 * Delegates to core's `resolveSyncUrl` rather than re-deriving the rule: a
 * private copy here would keep working right up until the socket path changes,
 * at which point the extension would connect to a URL the server no longer
 * serves — with no typecheck or test failure to say so, because
 * `connectSync` skips an unusable URL quietly.
 *
 * The empty origin is what makes this the one-argument form: an extension has
 * no page origin to fall back to, and `resolveSyncUrl` already returns "" when
 * neither input parses, so callers can skip connecting rather than throw.
 */
export function syncUrlFrom(apiUrl: string): string {
  return resolveSyncUrl(apiUrl, "");
}
