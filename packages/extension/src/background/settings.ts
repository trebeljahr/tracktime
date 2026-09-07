/**
 * Writing settings from the popup.
 *
 * Two traps, both of which fail silently rather than loudly:
 *
 * The server publishes `settings.changed` carrying this worker's own origin id,
 * and `connectSync` drops our own echo — so nothing else would ever refill the
 * settings cache. It is therefore *set* from the mutation's return value, never
 * nulled: nulling would cost a needless `settings.get` on the very next
 * snapshot, three seconds later.
 *
 * `chrome.idle`'s detection interval is set once and sticks. A threshold the
 * user just changed would not take effect until the worker was next evicted
 * unless `syncDetectionInterval` runs again — see the comment on
 * `background/idle.ts`'s own `syncDetectionInterval`.
 *
 * Setting the cache only from a *successful* mutation is also what makes the
 * workspace-field refusal free. `settings.update` throws FORBIDDEN for a member
 * touching `currency`, `defaultHourlyRate` or `weekStartsOn`; on that path the
 * cache still holds the server's truth, so the next snapshot re-renders the old
 * value with no rollback code and no popup-side merge.
 *
 * Nothing here is queueable offline. `settings.update` is not one of core's
 * offline ops, and making it one would need a merge policy for two partial
 * patches to the same block — which the server does not have either.
 */
import type { ResolvedSettings } from "@starter/core";
import type { SettingsPatch } from "../lib/messaging";
import { BackgroundError } from "./errors";
import { syncDetectionInterval } from "./idle";
import { ensureReady, ORIGIN_ID, setCachedSettings } from "./runtime";

const notSignedIn = (): BackgroundError =>
  new BackgroundError("NOT_SIGNED_IN", "Sign in before changing settings.");

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const current = await ensureReady();
  if (!current.session) throw notSignedIn();

  const settings = await current.api.mutate<ResolvedSettings>(
    "settings.update",
    { ...patch, originId: ORIGIN_ID },
  );

  setCachedSettings(settings);

  if (patch.idle !== undefined) await syncDetectionInterval();
}
