import type { SyncEvent } from "@starter/shared";
import { userRoomId } from "@starter/shared";
import { WorkspaceMember } from "../models/WorkspaceMember.js";
import { roomManager } from "./handler.js";

/** Re-exported so mutations never hand-roll the room name. */
export { userRoomId };

/**
 * Broadcast to one person's devices.
 *
 * For events that are about the human rather than the workspace: their own
 * preference changes, a device being signed out.
 */
export function publishToUser(
  userId: string,
  event: SyncEvent,
  originId?: string,
): void {
  if (!userId) return;
  try {
    roomManager.broadcast(userRoomId(userId), {
      type: "tt:sync",
      event,
      ...(originId ? { originId } : {}),
    });
  } catch {
    // Realtime delivery is best-effort — never fail the mutation.
  }
}

/**
 * Broadcast a mutation's {@link SyncEvent} to every member of a workspace.
 *
 * Room topology stays one room per PERSON (`user:<userId>`); the fan-out is
 * resolved here instead. That is deliberate: a room broadcasts one serialized
 * blob to everyone in it, and once entries carry money that a given member may
 * or may not see, the payload has to differ per recipient anyway. Keeping the
 * fan-out in code means the visibility rule lives in one testable function
 * rather than in the room graph.
 *
 * NOT YET per-recipient: every member currently receives the identical
 * payload, which is correct only while a workspace has one member. The
 * per-recipient projection (stripping `hourlyRate`/`currency` from members
 * without `canViewOthersMoney`) MUST land before invitations ship, or the
 * first second member receives rates the reports correctly hide.
 *
 * `originId` is the per-tab uuid carried on the mutation input; it is echoed
 * on the envelope so the originating client can ignore its own echo.
 */
export async function publishSync(
  workspaceId: string,
  event: SyncEvent,
  originId?: string,
): Promise<void> {
  if (!workspaceId) return;
  try {
    const members = await WorkspaceMember.find({ workspaceId })
      .select({ userId: 1 })
      .lean();
    for (const member of members) {
      publishToUser(member.userId, event, originId);
    }
  } catch {
    // Realtime delivery is best-effort — never fail the mutation.
  }
}
