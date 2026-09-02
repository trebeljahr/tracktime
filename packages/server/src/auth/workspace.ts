// Resolving which workspace a request runs in, and what the caller may see.
//
// The rule (Stage 0, decision 3): an explicit `workspaceId` on the input ALWAYS
// wins; the session's active organization is only the default. Session-implicit
// scope is a footgun for the clients that cannot re-read it — a Raycast menu
// bar that has been open for three days, and a browser extension borrowing the
// web app's cookie without controlling it.
import type { Visibility } from "@starter/shared";
import {
  WorkspaceMember,
  visibilityOf,
  type WorkspaceMemberDocLike,
} from "../models/WorkspaceMember.js";
import {
  createPersonalWorkspace,
  type WorkspaceOwner,
} from "./personal-workspace.js";
import { getAuth } from "./auth.js";

export type ResolvedWorkspace = {
  workspaceId: string;
  membership: WorkspaceMemberDocLike;
  visibility: Visibility;
};

/**
 * The workspace a user falls back to when a request names none.
 *
 * Repair path as well as read path: any user without a membership — one that
 * predates the signup hook, or one whose hook failed — gets their personal
 * workspace created here on first use. That is what makes "every user has at
 * least one workspace" an invariant rather than an aspiration.
 */
export async function ensurePersonalWorkspace(
  user: WorkspaceOwner,
): Promise<string | null> {
  const existing = await WorkspaceMember.findOne({ userId: user.id })
    .sort({ createdAt: 1 })
    .lean();
  if (existing) return existing.workspaceId;

  return createPersonalWorkspace(getAuth().api, user);
}

/**
 * Pull a caller-supplied workspace id off the raw input.
 *
 * Raw, because this runs before the procedure's own zod schema. Nothing is
 * trusted on the strength of this value — it only selects which membership to
 * look up, and a workspace the caller is not a member of resolves to no
 * membership at all.
 */
export function workspaceIdFromInput(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as { workspaceId?: unknown }).workspaceId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolve the workspace for one request: explicit input, else the session's
 * active organization, else the caller's personal workspace.
 *
 * Returns null when the caller is not a member of the resolved workspace, so
 * the middleware can answer NOT_FOUND. A workspace somebody else owns must be
 * indistinguishable from one that does not exist.
 */
export async function resolveWorkspace(args: {
  user: WorkspaceOwner;
  requested: string | null;
  activeWorkspaceId: string | null;
}): Promise<ResolvedWorkspace | null> {
  const workspaceId =
    args.requested ??
    args.activeWorkspaceId ??
    (await ensurePersonalWorkspace(args.user));
  if (!workspaceId) return null;

  const membership = await WorkspaceMember.findOne({
    workspaceId,
    userId: args.user.id,
  }).lean();
  if (!membership) return null;

  return {
    workspaceId,
    membership,
    visibility: visibilityOf(membership),
  };
}
