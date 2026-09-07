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
  | {
      kind: "catalog.changed";
      scope: "client" | "project" | "task" | "tag";
      /**
       * Set when the change rewrote time entries too — a cascading delete
       * detaches every entry that pointed at the removed project or task, so
       * the entry caches are stale even though no entry event was published.
       */
      entriesTouched?: boolean;
    }
  /**
   * The pinned quick starts changed — added, removed or reordered.
   *
   * Its own kind rather than a `catalog.changed` scope: a favorite is not a
   * catalog document (Client -> Project -> Task), and folding it in would make
   * every client refetch the whole catalog and every report to learn that a
   * chip moved one slot to the left.
   */
  | { kind: "favorites.changed" }
  /**
   * An invoice was created, had its status changed, or was deleted. The id is
   * enough — clients refetch rather than trusting a broadcast snapshot, since
   * an invoice carries money and must never be rendered from stale gossip.
   */
  | { kind: "invoice.changed"; id: string }
  | { kind: "settings.changed" }
  /**
   * A bulk import landed or was undone. One event for the whole batch, not one
   * per entry: an import writes thousands of rows at once, and a client that
   * received thousands of `entry.upserted` events would spend the import
   * re-rendering instead of showing the result. Every cache is stale after
   * this, so clients invalidate rather than patch.
   */
  | { kind: "data.imported"; batchId: string; undone: boolean };

/** Room name every sync event for a given owner is published to. */
export const userRoomId = (ownerId: string): string => `user:${ownerId}`;

/** Narrowing helper for the sync envelope. */
export const isSyncMessage = (
  message: ServerToClientMessage
): message is Extract<ServerToClientMessage, { type: "tt:sync" }> =>
  message.type === "tt:sync";
