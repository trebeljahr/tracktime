// Every user gets a personal workspace at signup.
//
// This is the invariant that keeps ownership single-shaped: there is never a
// "user with no workspace" state, so no query, resolver or client ever needs a
// solo-vs-team branch. A solo user simply has a workspace of one.
//
// The workspace IS a better-auth organization — the same id from the very
// first migration, so adopting the plugin's invite/role endpoints in a later
// stage never reissues workspace ids.
import type { WorkspaceRole } from "@starter/shared";
import { WorkspaceMember } from "../models/WorkspaceMember.js";

/** Everything this module needs from a user, so it is trivially testable. */
export type WorkspaceOwner = {
  id: string;
  name?: string | null;
  email?: string | null;
};

/** Minimal surface of `auth.api` used here — keeps the `any` contained. */
type OrgApi = {
  createOrganization: (args: {
    body: { name: string; slug: string; userId: string };
  }) => Promise<{ id?: unknown } | null>;
};

const MAX_SLUG_LENGTH = 48;

/**
 * A slug from the user's email local part, with the user id as the uniqueness
 * tail. Slugs are globally unique across organizations, so a bare "rico" would
 * collide with the second Rico who ever signs up.
 */
export function personalWorkspaceSlug(user: WorkspaceOwner): string {
  const local = (user.email ?? "").split("@")[0] ?? "";
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const tail = user.id.slice(-8).toLowerCase();
  const head = (base || "workspace").slice(0, MAX_SLUG_LENGTH - tail.length - 1);
  return `${head}-${tail}`;
}

/** "Rico's workspace", falling back to the email when there is no name. */
export function personalWorkspaceName(user: WorkspaceOwner): string {
  const who = (user.name ?? "").trim() || (user.email ?? "").split("@")[0] || "My";
  return `${who}'s workspace`;
}

/**
 * Mirror a membership into the app-owned collection.
 *
 * better-auth's `member` row is written by the plugin; this is the sibling
 * record that carries the things the plugin does not model — the billing rate
 * and the two visibility flags.
 *
 * An owner sees everything: they are alone in a personal workspace, and in a
 * shared one they are the person who invited everybody else.
 */
export async function upsertWorkspaceMember(args: {
  workspaceId: string;
  user: WorkspaceOwner;
  role: WorkspaceRole;
}): Promise<void> {
  const sees = args.role === "owner" || args.role === "admin";
  await WorkspaceMember.updateOne(
    { workspaceId: args.workspaceId, userId: args.user.id },
    {
      $set: { role: args.role, name: args.user.name ?? args.user.email ?? "" },
      $setOnInsert: {
        workspaceId: args.workspaceId,
        userId: args.user.id,
        hourlyRate: null,
        canViewOthersTime: sees,
        canViewOthersMoney: sees,
      },
    },
    { upsert: true },
  );
}

/**
 * Create the personal workspace for a freshly created user and mirror the
 * membership. Returns the new workspace id, or null when creation failed.
 *
 * Never throws: a signup must not fail because the workspace could not be
 * created. `ensurePersonalWorkspace` on the read path repairs the gap for any
 * user that slips through (including every user that predates this hook).
 */
export async function createPersonalWorkspace(
  api: OrgApi,
  user: WorkspaceOwner,
): Promise<string | null> {
  try {
    const organization = await api.createOrganization({
      body: {
        name: personalWorkspaceName(user),
        slug: personalWorkspaceSlug(user),
        userId: user.id,
      },
    });

    const workspaceId = organization?.id ? String(organization.id) : null;
    if (!workspaceId) return null;

    await upsertWorkspaceMember({ workspaceId, user, role: "owner" });
    return workspaceId;
  } catch (error) {
    console.error("[auth] could not create personal workspace", error);
    return null;
  }
}
