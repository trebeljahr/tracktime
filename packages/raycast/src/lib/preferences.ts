import { getPreferenceValues } from "@raycast/api";

const trimSlash = (value: string): string => value.trim().replace(/\/+$/, "");

/** Server origin every API and auth call is made against. */
export const apiUrl = (): string => {
  const { apiUrl } = getPreferenceValues<ExtensionPreferences>();
  return trimSlash(apiUrl);
};

/** Web app origin — the device-pairing page and "Open in Browser" live here. */
export const webUrl = (): string => {
  const { webUrl } = getPreferenceValues<ExtensionPreferences>();
  return trimSlash(webUrl);
};

/** Deep link into a page of the web app, e.g. `webLink("/track")`. */
export const webLink = (path: string): string =>
  `${webUrl()}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Host without the scheme, for Raycast's metadata column.
 *
 * That column is narrow and renders plain text — a full URL truncates to
 * "https://api.example…" and hides the part that matters.
 */
export const hostLabel = (url: string): string =>
  url.replace(/^https?:\/\//, "") || url;
