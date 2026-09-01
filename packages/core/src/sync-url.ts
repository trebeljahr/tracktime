/**
 * Where the sync socket lives, derived from whatever API base URL a client was
 * built against. Kept framework-free so the browser extension's service worker
 * and the Raycast client derive the same URL as the web app, from the same
 * rule, rather than each re-deriving it slightly differently.
 */

/**
 * `wss://api.example.com/ws` from `https://api.example.com`. With no
 * `NEXT_PUBLIC_API_URL` the socket is same-origin, which is what the local
 * dev proxy and single-origin deployments want.
 */
export const resolveSyncUrl = (apiUrl: string, origin: string): string => {
  const base = apiUrl.trim() === "" ? origin : apiUrl.trim();
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return "";
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
};
