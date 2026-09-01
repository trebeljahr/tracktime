import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "http";
import type { ClientToServerMessage } from "@starter/shared";
import { userRoomId } from "@starter/shared";
import { authenticateUpgrade } from "./auth.js";
import { RoomManager } from "./rooms.js";
import { env, getTrustedOrigins } from "../config/env.js";

const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;

export const roomManager = new RoomManager();

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
        socket.destroy();
        return;
      }
    }

    // Authenticate. An unauthenticated socket can never join a room (both
    // join paths below require `ws.userId`), so refuse the upgrade outright
    // rather than holding a connection open that can do nothing.
    const session = await authenticateUpgrade(req);
    if (!session?.user?.id) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as WebSocket & { userId?: string; displayName?: string }).userId =
        session?.user?.id;
      (ws as WebSocket & { displayName?: string }).displayName =
        session?.user?.name ?? "Anonymous";
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket & { userId?: string; displayName?: string }, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("roomId");

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
      roomManager.leave(ws);
    });
  });

  // Periodic room pruning (every 30 minutes)
  setInterval(() => {
    roomManager.pruneEmpty();
  }, 30 * 60 * 1000);

  return wss;
}
