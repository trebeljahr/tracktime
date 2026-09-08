import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "http";
import type { ClientToServerMessage } from "@starter/shared";
import { userRoomId } from "@starter/shared";
import { enforceMaxEntryDuration } from "../services/runaway.js";
import { authenticateUpgrade, probeUpgradeSession } from "./auth.js";
import { RoomManager } from "./rooms.js";
import {
  SESSION_REVOKED_CLOSE_CODE,
  SessionWatch,
  type SessionProbe,
} from "./session-watch.js";
import { env, getTrustedOrigins } from "../config/env.js";

const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;

/**
 * How often a live socket's session is re-checked.
 *
 * The handshake authenticates once, and a phone holds its socket open for
 * days — so without this, "sign this device out" signs out only the HTTP half
 * and the socket keeps streaming that user's sync events. A minute is the
 * trade: one indexed session lookup per connected device per minute, against
 * a revocation that is never more than a minute from taking effect on the
 * socket too. Revocation is still instant on every HTTP request.
 */
const SESSION_RECHECK_INTERVAL_MS = 60_000;

/** A socket that has been through `authenticateUpgrade`. */
type AuthedSocket = WebSocket & {
  userId?: string;
  displayName?: string;
  probeSession?: SessionProbe;
};

export const roomManager = new RoomManager();

/** Live sockets, and the session lookup that keeps each one honest. */
export const sessionWatch = new SessionWatch();

/**
 * Drop a socket whose session no longer exists.
 *
 * The room is left explicitly rather than waiting for the `close` handler:
 * `close()` is asynchronous, and a broadcast that lands in the meantime would
 * be one more event delivered to a device that has been signed out — which is
 * the entire bug.
 */
const dropRevokedSocket = (socket: WebSocket): void => {
  roomManager.leave(socket);
  socket.close(SESSION_REVOKED_CLOSE_CODE, "session revoked");
};

/**
 * One pass of the re-check: drop every watched socket whose session is gone,
 * and answer how many that was.
 *
 * Exported so the test suite runs exactly what the interval runs, rather than
 * a re-implementation of it that could drift from the wiring it is meant to
 * be pinning.
 */
export const revokeStaleSockets = (): Promise<number> =>
  sessionWatch.sweep(dropRevokedSocket);

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    /**
     * A browser that offers a subprotocol closes the socket unless the server
     * echoes one back. The extension carries its session token as
     * `bearer.<token>` (see ws/auth.ts), so accept that one and ignore the
     * rest — the token is read from the request, not from what we echo.
     */
    handleProtocols: (protocols) => {
      for (const protocol of protocols) {
        if (protocol.startsWith("bearer.")) return protocol;
      }
      return false;
    },
  });

  // Handle HTTP upgrade manually for path/origin validation
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Only accept WS connections on known paths
    if (path !== "/ws" && path !== "/api/ws") {
      socket.destroy();
      return;
    }

    // Origin validation in production
    if (env.isProduction) {
      const trusted = getTrustedOrigins();
      const origin = req.headers.origin;
      if (origin && trusted.length > 0 && !trusted.includes(origin)) {
        // Answered rather than dropped, and logged with the origin: a silent
        // destroy reaches a browser as a bare close with no code, which is
        // indistinguishable from a network failure. That is how a client can
        // end up looking "offline" while its HTTP requests — which extensions
        // make outside CORS — keep working perfectly. The line below names the
        // exact value to add to TRUSTED_ORIGINS.
        console.warn(`[ws] upgrade refused: untrusted origin ${origin}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    // Authenticate. An unauthenticated socket can never join a room (both
    // join paths below require `ws.userId`), so refuse the upgrade outright
    // rather than holding a connection open that can do nothing.
    const authenticated = await authenticateUpgrade(req);
    if (!authenticated?.session.user?.id) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const { session, headers } = authenticated;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const authedWs = ws as AuthedSocket;
      authedWs.userId = session.user.id;
      authedWs.displayName = session.user.name ?? "Anonymous";
      // The credential that opened this socket, replayable for as long as it
      // stays open. Captured here because `req` is not kept past the upgrade.
      authedWs.probeSession = () => probeUpgradeSession(headers);
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: AuthedSocket, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    const roomId = url.searchParams.get("roomId");

    // Re-checked on a timer for the life of the socket, so revoking a device
    // in Settings → Devices closes its socket too rather than only 401ing its
    // next HTTP request.
    if (ws.probeSession) sessionWatch.watch(ws, ws.probeSession);

    // Auto-join room if roomId provided
    if (roomId && ws.userId) {
      roomManager.join(roomId, ws.userId, ws.displayName ?? "Anonymous", ws);
    } else if (ws.userId) {
      // No explicit room: join the user's own sync room so every device of
      // this user receives that user's realtime sync events.
      roomManager.join(
        userRoomId(ws.userId),
        ws.userId,
        ws.displayName ?? "Anonymous",
        ws,
      );

      // A device reconnecting is one of the moments that resolves "what is
      // running", so it is one of the moments the runaway guard is evaluated
      // at — a laptop opened on Monday morning finds out about the Friday
      // timer here, before it renders a clock that has been counting all
      // weekend. Deliberately not awaited: the socket is live either way, and
      // anything the guard does reaches this room as a normal sync event.
      // `null`, i.e. unconfined: a socket is authenticated as the PERSON, so
      // the guard should reach their timer wherever it is running. A token
      // principal passes its workspace id instead — see services/runaway.ts.
      void enforceMaxEntryDuration(ws.userId, null);
    }

    // Ping/pong heartbeat
    let isAlive = true;
    ws.on("pong", () => {
      isAlive = true;
    });

    const pingInterval = setInterval(() => {
      if (!isAlive) {
        clearInterval(pingInterval);
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, PING_INTERVAL_MS);

    // Message handling
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientToServerMessage;

        if (message.type === "join-room" && ws.userId) {
          roomManager.join(
            message.roomId,
            ws.userId,
            ws.displayName ?? "Anonymous",
            ws,
          );
        } else {
          roomManager.handleMessage(ws, message);
        }
      } catch {
        roomManager.send(ws, {
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Could not parse message",
        });
      }
    });

    // Cleanup on close
    ws.on("close", () => {
      clearInterval(pingInterval);
      sessionWatch.unwatch(ws);
      roomManager.leave(ws);
    });
  });

  // Periodic session re-check, so a revoked session loses its socket.
  //
  // Both timers are unref'd: the listening HTTP server is what keeps the
  // process alive, and a bare `setInterval` here would instead keep a
  // short-lived process (a test, a script) running for half an hour.
  const recheckInterval = setInterval(() => {
    void revokeStaleSockets();
  }, SESSION_RECHECK_INTERVAL_MS);
  recheckInterval.unref?.();

  // Periodic room pruning (every 30 minutes)
  const pruneInterval = setInterval(() => {
    roomManager.pruneEmpty();
  }, 30 * 60 * 1000);
  pruneInterval.unref?.();

  return wss;
}
