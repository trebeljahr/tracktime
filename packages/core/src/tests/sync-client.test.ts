/**
 * The socket contract, exercised against a real `ws` server on a real Node
 * WebSocket.
 *
 * Raycast, the CLI and the desktop shell all reach the sync socket through
 * the host's global `WebSocket` rather than a bundled library, and they carry
 * their session token in the subprotocol because a WebSocket constructor
 * cannot set a header. Both halves of that are easy to break in a way no
 * type-check catches and only a live client notices, so they are asserted
 * here rather than assumed.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import { WebSocketServer } from "ws";
import { createSyncClient } from "../sync-client.js";
import type { SyncEvent } from "@starter/shared";

const BEARER = "bearer.";

type Harness = {
  url: string;
  /** Subprotocols the last connection offered. */
  offered: string[];
  send: (event: SyncEvent, originId?: string) => void;
  sendRaw: (payload: string) => void;
  close: () => Promise<void>;
};

const harness = async (): Promise<Harness> => {
  const http: Server = createServer();
  const state: { offered: string[]; sockets: Set<import("ws").WebSocket> } = {
    offered: [],
    sockets: new Set(),
  };

  const wss = new WebSocketServer({
    server: http,
    path: "/api/ws",
    handleProtocols: (protocols) => {
      state.offered = [...protocols];
      for (const protocol of protocols) {
        if (protocol.startsWith(BEARER)) return protocol;
      }
      return false;
    },
  });

  wss.on("connection", (socket) => {
    state.sockets.add(socket);
    socket.on("close", () => state.sockets.delete(socket));
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `ws://127.0.0.1:${address.port}/api/ws`,
    get offered() {
      return state.offered;
    },
    send: (event, originId) => {
      const payload = JSON.stringify({
        type: "tt:sync",
        event,
        ...(originId ? { originId } : {}),
      });
      for (const socket of state.sockets) socket.send(payload);
    },
    sendRaw: (payload) => {
      for (const socket of state.sockets) socket.send(payload);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of state.sockets) socket.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
};

test("a Node host connects with its token in the subprotocol and receives events", async () => {
  assert.equal(
    typeof globalThis.WebSocket,
    "function",
    "this Node has no global WebSocket — the token clients rely on it",
  );

  const server = await harness();
  after(() => server.close());

  const received: Array<{ event: SyncEvent; originId?: string }> = [];
  let opened: () => void = () => {};
  const isOpen = new Promise<void>((resolve) => {
    opened = resolve;
  });

  const client = createSyncClient({
    url: server.url,
    token: "tok en/+",
    onEvent: (event, originId) => {
      received.push({ event, originId });
    },
    onStatus: (status) => {
      if (status === "open") opened();
    },
  });
  after(() => client.close());
  client.connect();
  await isOpen;

  // Percent-encoded, because a raw token can hold characters a header value
  // may not — and decoded back to the original on the server side.
  assert.deepEqual(server.offered, [`${BEARER}${encodeURIComponent("tok en/+")}`]);
  assert.equal(
    decodeURIComponent(server.offered[0].slice(BEARER.length)),
    "tok en/+",
  );

  const delivered = new Promise<void>((resolve) => {
    const id = setInterval(() => {
      if (received.length > 0) {
        clearInterval(id);
        resolve();
      }
    }, 5);
  });
  server.send({ kind: "timer.stopped", entry: { id: "e1" } as never }, "web-1");
  await delivered;

  assert.equal(received[0].event.kind, "timer.stopped");
  assert.equal(received[0].originId, "web-1");

  client.close();
  assert.equal(client.status(), "closed");
});

test("a malformed frame is ignored rather than killing the socket", async () => {
  const server = await harness();
  after(() => server.close());

  const received: SyncEvent[] = [];
  let opened: () => void = () => {};
  const isOpen = new Promise<void>((resolve) => {
    opened = resolve;
  });

  const client = createSyncClient({
    url: server.url,
    token: "t",
    onEvent: (event) => {
      received.push(event);
    },
    onStatus: (status) => {
      if (status === "open") opened();
    },
  });
  after(() => client.close());
  client.connect();
  await isOpen;

  const delivered = new Promise<void>((resolve) => {
    const id = setInterval(() => {
      if (received.length > 0) {
        clearInterval(id);
        resolve();
      }
    }, 5);
  });

  // Unparseable, then valid JSON that is not a sync envelope, then the real
  // event. Only the last reaches the consumer, and the socket survives all of
  // them — a client that dropped its connection on a frame it did not
  // recognise would stop syncing the moment the protocol grew.
  server.sendRaw("{not json");
  server.sendRaw(JSON.stringify({ type: "chat", text: "hi" }));
  server.sendRaw(JSON.stringify({ type: "tt:sync" }));
  server.send({ kind: "favorites.changed" });
  await delivered;

  assert.equal(client.status(), "open");
  assert.deepEqual(received, [{ kind: "favorites.changed" }]);
});
