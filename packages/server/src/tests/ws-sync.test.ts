import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import type { ServerToClientMessage } from "@starter/shared";
// Subpath import: a bare named import from "@starter/shared" throws under tsx
// (see the note in duration.test.ts) — which is also why `publishSync` itself
// cannot be exercised here: `src/ws/sync.ts` uses the bare specifier and the
// module fails to load. Add those tests once that bug is fixed.
import { userRoomId } from "@starter/shared/protocol";
import { RoomManager } from "../ws/rooms.js";

/** A socket stand-in that records what the server sent it. */
type FakeSocket = WebSocket & { sent: ServerToClientMessage[] };

const fakeSocket = (readyState = 1): FakeSocket => {
  const sent: ServerToClientMessage[] = [];
  const socket = {
    readyState,
    sent,
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerToClientMessage);
    },
  };
  return socket as unknown as FakeSocket;
};

const messagesOfType = <T extends ServerToClientMessage["type"]>(
  socket: FakeSocket,
  type: T
): Extract<ServerToClientMessage, { type: T }>[] =>
  socket.sent.filter(
    (message): message is Extract<ServerToClientMessage, { type: T }> =>
      message.type === type
  );

// ── room names ───────────────────────────────────────────────────────

test("userRoomId namespaces a user's own room", () => {
  assert.equal(userRoomId("u1"), "user:u1");
  assert.notEqual(userRoomId("u1"), userRoomId("u2"));
});

// ── RoomManager ──────────────────────────────────────────────────────

test("joining sends room state to the joiner and announces them to the rest", () => {
  const rooms = new RoomManager();
  const first = fakeSocket();
  const second = fakeSocket();

  rooms.join("user:u1", "u1", "Rico", first);
  assert.deepEqual(
    messagesOfType(first, "room-state").map((message) => message.roomId),
    ["user:u1"]
  );

  rooms.join("user:u1", "u1", "Rico (phone)", second);
  assert.equal(messagesOfType(first, "member-joined").length, 1);
  assert.equal(
    messagesOfType(second, "member-joined").length,
    0,
    "the joiner does not announce itself to itself"
  );
  assert.equal(rooms.getMembers("user:u1").length, 2);
});

test("broadcast reaches every member of the room except the excluded socket", () => {
  const rooms = new RoomManager();
  const first = fakeSocket();
  const second = fakeSocket();
  const outsider = fakeSocket();

  rooms.join("user:u1", "u1", "Rico", first);
  rooms.join("user:u1", "u1", "Rico (phone)", second);
  rooms.join("user:u2", "u2", "Someone else", outsider);

  rooms.broadcast("user:u1", { type: "state-update", payload: { a: 1 } }, first);

  assert.equal(messagesOfType(first, "state-update").length, 0, "sender excluded");
  assert.deepEqual(messagesOfType(second, "state-update"), [
    { type: "state-update", payload: { a: 1 } },
  ]);
  assert.equal(
    messagesOfType(outsider, "state-update").length,
    0,
    "another user's room never sees the broadcast"
  );
});

test("broadcast skips sockets that are not open", () => {
  const rooms = new RoomManager();
  const closing = fakeSocket(2);
  rooms.join("user:u1", "u1", "Rico", closing);
  const before = closing.sent.length;

  rooms.broadcast("user:u1", { type: "state-update", payload: {} });
  assert.equal(closing.sent.length, before);
});

test("leaving removes the member and drops the room once it is empty", () => {
  const rooms = new RoomManager();
  const first = fakeSocket();
  const second = fakeSocket();

  rooms.join("user:u1", "u1", "Rico", first);
  rooms.join("user:u1", "u1", "Rico (phone)", second);

  rooms.leave(second);
  assert.equal(rooms.getMembers("user:u1").length, 1);
  assert.equal(messagesOfType(first, "member-left").length, 1);

  rooms.leave(first);
  assert.equal(rooms.getRoomCount(), 0);
  assert.equal(rooms.getConnectionCount(), 0);
  assert.deepEqual(rooms.getMembers("user:u1"), []);
});

test("leaving twice is harmless", () => {
  const rooms = new RoomManager();
  const socket = fakeSocket();
  rooms.join("user:u1", "u1", "Rico", socket);
  rooms.leave(socket);
  rooms.leave(socket);
  assert.equal(rooms.getRoomCount(), 0);
});

test("joining a second room leaves the first", () => {
  const rooms = new RoomManager();
  const socket = fakeSocket();

  rooms.join("user:u1", "u1", "Rico", socket);
  rooms.join("user:u2", "u2", "Rico", socket);

  assert.deepEqual(rooms.getMembers("user:u1"), []);
  assert.equal(rooms.getMembers("user:u2").length, 1);
  assert.equal(rooms.getConnectionCount(), 1);
});

test("broadcasting to an unknown room is a no-op", () => {
  const rooms = new RoomManager();
  rooms.broadcast("user:nobody", { type: "state-update", payload: {} });
  assert.equal(rooms.getRoomCount(), 0);
});
