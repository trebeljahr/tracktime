/**
 * Deciding whether a failed session check means "signed out".
 *
 * On the web this was never load-bearing: the server is one hop away, a
 * failure is rare, and /login is a reasonable place to land. On a phone it is
 * the single line that decides whether the app works at all. Cold launch with
 * no signal is the *normal* case there, and treating it as a sign-out puts a
 * validly signed-in user on a login form they cannot complete, with the
 * running timer unmounted behind it.
 *
 * Two failure shapes have to be handled, not one:
 *
 *  - the promise REJECTS — `fetch` itself threw, i.e. no network at all;
 *  - the promise RESOLVES with `{ data: null, error: { status } }` —
 *    `@better-fetch/fetch` only rejects when the underlying fetch throws and
 *    otherwise resolves with an error object, so a 502 from a proxy
 *    mid-redeploy, or a captive portal, arrives on the success path.
 *
 * Only a clean `{ data: null, error: null }` — the server answered, and it
 * says there is no session — is proof of being signed out.
 */

/** The shape `authClient.getSession()` resolves with, narrowed to what matters. */
export type SessionResult = {
  data?: { session?: unknown } | null;
  error?: unknown;
} | null | undefined;

export type Verdict = "in" | "out";

export type VerdictContext = {
  /** True when a bearer token is stored, i.e. this device has signed in. */
  hasStoredToken: boolean;
};

/** Verdict for a `getSession()` that resolved. */
export const verdictForResult = (
  result: SessionResult,
  context: VerdictContext,
): Verdict => {
  if (result?.data?.session) return "in";
  // The request did not get a clean answer. A stored token says this device
  // has signed in and nothing has told us otherwise — keep the user inside.
  if (result?.error != null && context.hasStoredToken) return "in";
  return "out";
};

/** Verdict for a `getSession()` that rejected — the transport failed. */
export const verdictForRejection = (context: VerdictContext): Verdict =>
  context.hasStoredToken ? "in" : "out";
