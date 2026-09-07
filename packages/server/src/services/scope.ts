// Who is asking, and what they may see — the object every service function
// takes INSTEAD of a bare workspace id.
//
// This matters more than it looks. `tests/workspace-scoping.test.ts` is a
// source-level guard over `trpc/routers/`, and moving a resolver body into
// `services/` escapes it entirely. `WorkspaceScope` is what replaces that
// guard: a service function cannot be called without having answered both
// "which workspace" and "what may this caller see", because there is no
// overload that takes less. Modelled on `ReportScope` in
// trpc/routers/reports.ts, which already worked this way and is structurally
// assignable to it.
import type { Visibility } from "@starter/shared";
import type { ApiTokenAuth } from "../auth/api-token.js";

export type WorkspaceScope = {
  workspaceId: string;
  /** The acting person. Author-only writes filter on this, never on visibility. */
  userId: string;
  visibility: Visibility;
};

/** The tRPC path: straight off `workspaceProcedure`'s context. */
export function scopeFromContext(ctx: {
  workspaceId: string;
  user: { id: string };
  visibility: Visibility;
}): WorkspaceScope {
  return {
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    visibility: ctx.visibility,
  };
}

/**
 * The REST path: straight off an authenticated token.
 *
 * REST never enters tRPC — there is no synthetic context and no token path
 * through `workspaceProcedure`. This function is the whole bridge, and it is
 * why a token request can never reach `workspaceIdFromInput`: the workspace
 * comes off the token, not off the body.
 */
export function scopeFromApiToken(auth: ApiTokenAuth): WorkspaceScope {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    visibility: auth.visibility,
  };
}
