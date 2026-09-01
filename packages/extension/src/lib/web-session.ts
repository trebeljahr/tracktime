/**
 * Borrowing the web app's session, so signing in on one signs in on the other.
 *
 * better-auth stores its session as an `HttpOnly` cookie on the *API* origin,
 * and the value of that cookie is exactly the token the `bearer` plugin
 * accepts — a signed `<token>.<signature>` pair, the same shape the
 * `set-auth-token` header returns on a password sign-in. So the extension does
 * not need a second credential or a second sign-in: it reads the cookie the
 * browser already has and sends it as `Authorization: Bearer`.
 *
 * `HttpOnly` keeps page JavaScript out, not `chrome.cookies` — that is what the
 * `cookies` permission in the manifest buys, and why this never needs a content
 * script on the web app.
 *
 * The cookie is also the sign-out channel in both directions. Signing out in
 * the web app deletes it, `onChanged` fires, and the extension drops its copy;
 * signing out in the extension deletes it here, and the web app is signed out
 * the moment it next talks to the server.
 */

/**
 * Cookie names better-auth may have used, most likely first.
 *
 * The `__Secure-` prefix appears once `useSecureCookies` is on, which
 * better-auth infers from an https base URL — so which one exists depends on
 * whether the server is local or deployed, and the extension has to work
 * against both without being told which.
 */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

const cookiesApi = (): typeof chrome.cookies | null => {
  const api = (chrome as { cookies?: typeof chrome.cookies }).cookies;
  return api ?? null;
};

/**
 * The cookie value is percent-encoded on the wire (the signature is base64 and
 * carries `+` and `=`), and the bearer plugin wants the decoded form.
 */
const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // Not encoded, or encoded badly — the raw value is still worth a try.
    return value;
  }
};

/**
 * The web app's session token for this API origin, or null when the browser has
 * no session cookie for it — which is the ordinary "not signed in on the web"
 * case, not an error.
 */
export async function readWebSessionToken(
  apiUrl: string,
): Promise<string | null> {
  const api = cookiesApi();
  if (!api) return null;

  for (const name of SESSION_COOKIE_NAMES) {
    try {
      const cookie = await api.get({ url: apiUrl, name });
      if (cookie?.value) return decode(cookie.value);
    } catch {
      // A malformed URL or a revoked permission — try the next name, then
      // fall through to "no web session", which the caller handles anyway.
    }
  }
  return null;
}

/**
 * Delete the web app's session cookie.
 *
 * Called on sign-out so the web app does not keep rendering as signed in
 * against a session the server has already revoked. Best effort: the server
 * call is what actually invalidates the session, and this only stops the
 * browser presenting a corpse.
 */
export async function clearWebSessionCookie(apiUrl: string): Promise<void> {
  const api = cookiesApi();
  if (!api) return;

  for (const name of SESSION_COOKIE_NAMES) {
    try {
      await api.remove({ url: apiUrl, name });
    } catch {
      /* already gone, or no permission for this origin */
    }
  }
}

/**
 * Call `onChange` whenever the session cookie for `apiUrl`'s host appears or
 * disappears. Returns an unsubscribe function.
 *
 * Registered synchronously at worker startup, like every other listener here:
 * a listener added after an await is a listener that misses the event which
 * woke the worker.
 */
export function watchWebSession(
  getApiUrl: () => string,
  onChange: (token: string | null) => void,
): () => void {
  const api = cookiesApi();
  if (!api) return () => undefined;

  const listener = (info: chrome.cookies.CookieChangeInfo): void => {
    const name = info.cookie.name;
    if (!SESSION_COOKIE_NAMES.some((candidate) => candidate === name)) return;

    let host: string;
    try {
      host = new URL(getApiUrl()).hostname;
    } catch {
      return;
    }
    // Cookie domains may carry a leading dot for subdomain scope.
    const domain = info.cookie.domain.replace(/^\./, "");
    if (domain !== host) return;

    // "overwrite" is the removal half of a rewrite: the new value arrives as a
    // separate "explicit" event straight after, so treating it as a sign-out
    // would blank the popup for a moment on every session refresh.
    if (info.removed && info.cause === "overwrite") return;

    onChange(info.removed ? null : decode(info.cookie.value));
  };

  api.onChanged.addListener(listener);
  return () => api.onChanged.removeListener(listener);
}
