import type { EntrySource } from "@starter/shared";
import { isNative } from "@/mobile/bridge";

/**
 * Which client an entry was tracked from.
 *
 * `source` is stamped once, at write time, and is not backfillable — nothing
 * later in the entry's life knows where it came from. So this has to be right
 * before the first phone-tracked entry exists, not after.
 *
 * `isNative()` is a synchronous `window.Capacitor` read, so there is no async
 * state and no window in which a native write is mislabelled "web".
 */
export const entrySource = (): EntrySource =>
  isNative() ? "mobile" : "web";
