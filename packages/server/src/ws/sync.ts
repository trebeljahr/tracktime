import type { SyncEvent } from "@starter/shared";
import { userRoomId } from "@starter/shared";
import { roomManager } from "./handler.js";

/** Re-exported so mutations never hand-roll the room name. */
export { userRoomId };

/**
 * Broadcast a mutation's {@link SyncEvent} to every device of one user.
 *
 * `originId` is the per-tab uuid carried on the mutation input; it is echoed
 * on the envelope so the originating client can ignore its own echo.
 *
 * Safe to call before the WebSocket server has started (and from tests) — a
 * room with no members is simply a no-op, and any transport error is
 * swallowed so a mutation never fails because of realtime delivery.
 */
export function publishSync(
  ownerId: string,
  event: SyncEvent,
  originId?: string,
): void {
  if (!ownerId) return;
  try {
    roomManager.broadcast(userRoomId(ownerId), {
      type: "tt:sync",
      event,
      ...(originId ? { originId } : {}),
    });
  } catch {
    // Realtime delivery is best-effort — never fail the mutation.
  }
}
