import type { RoomMember, TimeEntry } from "./types.js";

// ── Client → Server ──────────────────────────────────────────────────

export type ClientToServerMessage =
  | { type: "join-room"; roomId: string }
  | { type: "leave-room" }
  | { type: "chat"; text: string }
  | { type: "action"; payload: Record<string, unknown> };

// ── Server → Client ──────────────────────────────────────────────────

export type ServerToClientMessage =
  | { type: "room-state"; roomId: string; members: RoomMember[] }
  | { type: "member-joined"; member: RoomMember }
  | { type: "member-left"; userId: string }
  | { type: "chat"; userId: string; displayName: string; text: string }
  | { type: "state-update"; payload: Record<string, unknown> }
  | { type: "tt:sync"; event: SyncEvent; originId?: string }
  | { type: "error"; code: string; message: string };

// ── tracktime realtime sync ──────────────────────────────────────────
//
// Every mutation broadcasts a SyncEvent into the owner's own room
// ("user:<ownerId>"). The mutation's `originId` (a per-tab uuid) is echoed
// on the envelope so the originating client can ignore its own echo.

export type SyncEvent =
  | { kind: "entry.upserted"; entry: TimeEntry }
  | { kind: "entry.deleted"; id: string }
  | { kind: "timer.started"; entry: TimeEntry }
  | { kind: "timer.stopped"; entry: TimeEntry }
  | { kind: "catalog.changed"; scope: "client" | "project" | "task" }
  | { kind: "settings.changed" };

/** Room name every sync event for a given owner is published to. */
export const userRoomId = (ownerId: string): string => `user:${ownerId}`;

/** Narrowing helper for the sync envelope. */
export const isSyncMessage = (
  message: ServerToClientMessage
): message is Extract<ServerToClientMessage, { type: "tt:sync" }> =>
  message.type === "tt:sync";
