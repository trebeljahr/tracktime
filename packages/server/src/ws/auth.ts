import type { IncomingMessage } from "http";
import { getAuth } from "../auth/auth.js";
import {
  extractBearerToken,
  looksLikeApiToken,
  resolveApiTokenPrincipal,
} from "../auth/api-token.js";
import { fromNodeHeaders } from "better-auth/node";

/**
 * Pull a personal API token off an upgrade request.
 *
 * Header first (`Authorization: Bearer tt_...`). The `?token=` query fallback
 * exists because the browser WebSocket API cannot set headers — it is what the
 * Chrome/Raycast extensions use.
 */
function extractUpgradeToken(req: IncomingMessage): string | null {
  const fromHeader = extractBearerToken(req.headers.authorization);
  if (fromHeader) return fromHeader;

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const candidate = url.searchParams.get("token");
    if (candidate && looksLikeApiToken(candidate)) return candidate.trim();
  } catch {
    return null;
  }
  return null;
}

/**
 * Authenticate a WebSocket upgrade request.
 *
 * Primary path is the better-auth session cookie. If there is no session, a
 * personal API token (`Authorization: Bearer tt_...` or `?token=tt_...`) is
 * accepted so extension clients can subscribe to their own sync room.
 *
 * Returns a `{ session, user }` envelope (the same shape better-auth's
 * `getSession()` yields) or null when unauthenticated. Never throws.
 */
export async function authenticateUpgrade(req: IncomingMessage) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session?.user) return session;
  } catch {
    // Fall through to the API-token path.
  }

  const raw = extractUpgradeToken(req);
  if (!raw) return null;
  return resolveApiTokenPrincipal(raw);
}
