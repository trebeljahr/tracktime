/**
 * How long a signed-in session lives — for **every** client, not just phones.
 *
 * Its own module so the number, the reasoning and the test that pins it sit
 * together, and so nothing has to construct a better-auth instance (and a
 * database connection) to assert on it.
 */

/**
 * Thirty days, replacing better-auth's seven-day default.
 *
 * **Why it moved.** Seven days is wrong for a phone. A session is only
 * extended when `getSession` runs, so a device left in a drawer over a holiday
 * comes back to a session row the next lookup deletes — and a native client
 * that kept working offline against a stored token then replays a queue of
 * genuinely tracked time into 401s. Thirty days makes the ordinary gap (a week
 * away, a phone in a drawer) survivable. `updateAge` of one day means one
 * refresh write per day rather than one per request.
 *
 * **What it also does, said out loud.** better-auth's `session.expiresIn` is
 * global: it is read when a session row is created, again on every refresh,
 * and again as the `max-age` of the browser's session cookie. So this number
 * did not only lengthen the mobile app's stored-token life — it took every
 * browser session on the web app from seven days to thirty at the same time. A
 * laptop that signs in and is not touched again stays signed in for a month.
 *
 * That is an accepted trade here and it is worth being explicit about why:
 * tracktime is a solo-user, self-hosted app, the threat model is a stolen
 * unlocked laptop rather than a shared kiosk, and revocation does not depend
 * on this window — Settings → Devices deletes the session row, after which the
 * next HTTP request fails immediately and the WebSocket is closed within a
 * minute (`ws/session-watch.ts`). Shorten it here if that ever stops being
 * true; it is one number and it moves both clients together.
 *
 * **Why not per client.** There is no clean hook for it in better-auth
 * 1.6.11. `databaseHooks.session.create.before` can write a different
 * `expiresAt` for, say, a cookie session, but nothing downstream respects it:
 * `api/routes/session` derives "is this session due for a refresh" as
 * `expiresAt - expiresIn + updateAge <= now` using the *global* `expiresIn`
 * (so a shorter row looks perpetually stale) and then refreshes it to
 * `now + expiresIn`, the global value again. A per-client expiry would
 * therefore be silently converted back to this one on the session's first
 * refresh — worse than not having it, because it would read as scoped while
 * behaving globally. If better-auth grows a real hook, scope it and delete
 * this paragraph.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

/**
 * How stale a session row may get before a request rewrites its expiry. One
 * write a day per active session rather than one per request.
 */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
