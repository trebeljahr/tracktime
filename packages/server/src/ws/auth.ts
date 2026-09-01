import type { IncomingMessage } from "http";
import { getAuth } from "../auth/auth.js";
import { fromNodeHeaders } from "better-auth/node";

/** Subprotocol prefix a browser client uses to carry its session token. */
const BEARER_SUBPROTOCOL_PREFIX = "bearer.";

/**
 * Find a session token on an upgrade request, for clients that have no cookie.
 *
 * Three sources, in descending order of how safe they are:
 *  1. `Authorization: Bearer <token>` — native clients (Raycast, CLI, the
 *     desktop shell) that can set headers on an upgrade.
 *  2. `Sec-WebSocket-Protocol: bearer.<token>` — the browser `WebSocket`
 *     constructor cannot set headers but *can* set a subprotocol, so this is
 *     the extension's path.
 *  3. `?token=` — last resort. A query string is the one place a session
 *     token can leak into a log or a referrer, so it is deliberately last.
 */
function extractUpgradeToken(req: IncomingMessage): string | null {
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const fromHeader = /^Bearer\s+(\S+)$/i.exec((authorization ?? "").trim());
  if (fromHeader) return fromHeader[1];

  const protocols = req.headers["sec-websocket-protocol"];
  const offered = (Array.isArray(protocols) ? protocols.join(",") : protocols)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fromProtocol = offered?.find((value) =>
    value.startsWith(BEARER_SUBPROTOCOL_PREFIX),
  );
  if (fromProtocol) {
    const token = fromProtocol.slice(BEARER_SUBPROTOCOL_PREFIX.length);
    if (token) return decodeURIComponent(token);
  }

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const candidate = url.searchParams.get("token");
    if (candidate) return candidate.trim();
  } catch {
    return null;
  }
  return null;
}

/**
 * Authenticate a WebSocket upgrade request.
 *
 * Same single credential as every other entry point: a better-auth session,
 * arriving either as a cookie (web app) or as a session token (everything
 * else). Returns better-auth's `{ session, user }` envelope, or null when
 * unauthenticated. Never throws — a failed upgrade must not take the server
 * down.
 */
export async function authenticateUpgrade(req: IncomingMessage) {
  const headers = fromNodeHeaders(req.headers);

  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers });
    if (session?.user) return session;
  } catch {
    // Fall through and retry with an explicit token, below.
  }

  const raw = extractUpgradeToken(req);
  if (!raw) return null;

  try {
    // The `bearer` plugin turns this header into the session lookup, exactly
    // as it does for HTTP requests — no separate verification path.
    headers.set("authorization", `Bearer ${raw}`);
    const session = await getAuth().api.getSession({ headers });
    return session?.user ? session : null;
  } catch {
    return null;
  }
}
