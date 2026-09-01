import { LocalStorage } from "@raycast/api";
import { createId, signOutSession, type IssuedSession } from "@starter/core";
import { apiUrl } from "./preferences.js";

/**
 * Where the session token lives.
 *
 * Raycast's `LocalStorage` is an encrypted, per-extension store — no other
 * extension can read it, and it never lands in a plain config file. That is
 * the right home for a better-auth session token: it is a bearer credential,
 * so anyone holding it is the user until it is revoked from Settings →
 * Devices.
 */
const TOKEN_KEY = "tracktime.session.token";
const EMAIL_KEY = "tracktime.session.email";
const ORIGIN_KEY = "tracktime.originId";

/** Names this client in Settings → Devices, and in the device flow. */
export const CLIENT_ID = "tracktime-raycast" as const;

export type StoredSession = {
  token: string;
  email: string | null;
};

export async function getStoredSession(): Promise<StoredSession | null> {
  const token = await LocalStorage.getItem<string>(TOKEN_KEY);
  if (!token) return null;
  const email = await LocalStorage.getItem<string>(EMAIL_KEY);
  return { token, email: email ?? null };
}

export async function storeSession(session: IssuedSession): Promise<void> {
  await LocalStorage.setItem(TOKEN_KEY, session.token);
  if (session.email) await LocalStorage.setItem(EMAIL_KEY, session.email);
  else await LocalStorage.removeItem(EMAIL_KEY);
}

/**
 * Forget the local token, and tell the server to drop the session too.
 *
 * The remote call is best effort: what actually protects the user is that the
 * token stops existing on this machine, so a failed round trip must not stop
 * that from happening.
 */
export async function signOut(): Promise<void> {
  const session = await getStoredSession();
  if (session) {
    await signOutSession(
      { baseUrl: apiUrl(), clientId: CLIENT_ID },
      session.token,
    );
  }
  await LocalStorage.removeItem(TOKEN_KEY);
  await LocalStorage.removeItem(EMAIL_KEY);
}

/**
 * Stable per-install id sent with every mutation, so the sync WebSocket can
 * tell "a change this client made" from "a change another client made" and
 * the web app does not double-apply our own writes.
 */
export async function getOriginId(): Promise<string> {
  const existing = await LocalStorage.getItem<string>(ORIGIN_KEY);
  if (existing) return existing;
  const created = `raycast-${createId()}`;
  await LocalStorage.setItem(ORIGIN_KEY, created);
  return created;
}
