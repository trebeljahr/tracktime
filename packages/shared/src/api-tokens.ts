// API tokens: the credential a script, a CI job or a third-party integration
// authenticates the public REST API with.
//
// Deliberately NOT a better-auth session. A session belongs to a person and
// follows them across every workspace they are in; a token is bound to ONE
// workspace and to the visibility its creator had at the moment they minted
// it. Conflating the two would mean a token silently gaining reach whenever
// its owner joined another workspace.

/**
 * Everything a token may be allowed to do.
 *
 * Read and write are separate entries rather than a level, because
 * `entries:write` implying `entries:read` is exactly the kind of implication
 * a reviewer stops checking. A route requiring read requires read.
 */
export const API_TOKEN_SCOPES = [
  "entries:read",
  "entries:write",
  "catalog:read",
  "catalog:write",
  "reports:read",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * A token as every client renders it — never its secret.
 *
 * The plaintext exists exactly once, in the response to `create`. There is no
 * shape in this file that can carry it back out of the database, because
 * there is no column holding it: only a sha256 of it is stored.
 */
export type ApiTokenSummary = {
  id: string;
  name: string;
  /** The non-secret half, shown so a token can be told apart in a list. */
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** The one and only response that carries the plaintext. */
export type CreatedApiToken = {
  token: ApiTokenSummary;
  plaintext: string;
};

/**
 * How a token is identified on screen: the prefix, never the secret.
 *
 * A shared helper rather than string interpolation at each call site, so the
 * web app, Raycast and the docs cannot end up displaying three different
 * things and making a support conversation about "which token is this"
 * impossible.
 */
export function apiTokenDisplayId(prefix: string): string {
  return `tt_${prefix}…`;
}
