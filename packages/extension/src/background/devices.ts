/**
 * Settings → Devices, from the toolbar.
 *
 * Fetched on demand rather than on the snapshot's critical path: the popup
 * re-reads state every three seconds, and a list of signed-in sessions does not
 * have to be right to the second — putting it in `buildState` would cost a
 * `devices.list` round trip every three seconds for a panel that is usually
 * closed.
 *
 * The current session is refused here, not just hidden in the UI. Revoking it
 * kills the bearer token while the worker still holds a session record, so the
 * popup would keep rendering as signed in against a dead credential — exactly
 * the half-applied state the whole-snapshot contract exists to prevent. Signing
 * this browser out is `auth:sign-out`, which clears the local record too.
 *
 * Each mutation refetches rather than splicing the local list: `revokeOthers`
 * cannot say which rows went, and the server's own list is the only honest
 * answer to "who is still signed in".
 */
import type { DeviceSession } from "@starter/core";
import { BackgroundError } from "./errors";
import {
  ensureReady,
  getCachedDevices,
  ORIGIN_ID,
  setCachedDevices,
} from "./runtime";

const notSignedIn = (): BackgroundError =>
  new BackgroundError("NOT_SIGNED_IN", "Sign in to see your devices.");

export async function listDevices(): Promise<DeviceSession[]> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  const devices = await current.api.query<DeviceSession[]>("devices.list");
  setCachedDevices(devices);
  return devices;
}

export async function revokeDevice(id: string): Promise<void> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  if (getCachedDevices()?.find((device) => device.id === id)?.current === true) {
    throw new BackgroundError(
      "REVOKE_SELF",
      "That is this browser. Use Sign out instead, so the extension forgets " +
        "its own session too.",
    );
  }

  await current.api.mutate("devices.revoke", { id, originId: ORIGIN_ID });
  await listDevices();
}

export async function revokeOtherDevices(): Promise<void> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  await current.api.mutate("devices.revokeOthers", { originId: ORIGIN_ID });
  await listDevices();
}
