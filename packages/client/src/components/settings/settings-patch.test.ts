/**
 * `applySettingsPatch` is the optimistic half of every settings write: it has
 * to land the same value the server will, or the "Saved" flash lies for one
 * round trip. The nested blocks are where that is easy to get wrong, because a
 * partial patch of one must not flatten the rest of it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DURATION_SETTINGS } from "@starter/shared";

import { FALLBACK_SETTINGS } from "@/lib/format";
import { applySettingsPatch } from "./use-workspace-settings";

describe("applySettingsPatch", () => {
  it("merges a partial maxDuration instead of replacing the block", () => {
    const next = applySettingsPatch(FALLBACK_SETTINGS, {
      maxDuration: { maxHours: 24 },
    });

    expect(next.maxDuration.maxHours).toBe(24);
    expect(next.maxDuration.behavior).toBe(
      DEFAULT_MAX_DURATION_SETTINGS.behavior,
    );
  });

  it("changes the behaviour without disturbing the threshold", () => {
    const next = applySettingsPatch(
      { ...FALLBACK_SETTINGS, maxDuration: { maxHours: 24, behavior: "ask" } },
      { maxDuration: { behavior: "cap" } },
    );

    expect(next.maxDuration).toEqual({ maxHours: 24, behavior: "cap" });
  });

  it("treats maxHours 0 as a real value, not as an absent one", () => {
    // The off switch writes 0, and `0` is falsy — the exact shape of bug that
    // would make the toggle silently refuse to turn the guard off.
    const next = applySettingsPatch(FALLBACK_SETTINGS, {
      maxDuration: { maxHours: 0 },
    });
    expect(next.maxDuration.maxHours).toBe(0);
  });

  it("leaves both nested blocks alone when neither is patched", () => {
    const next = applySettingsPatch(FALLBACK_SETTINGS, { currency: "USD" });
    expect(next.currency).toBe("USD");
    expect(next.maxDuration).toEqual(FALLBACK_SETTINGS.maxDuration);
    expect(next.idle).toEqual(FALLBACK_SETTINGS.idle);
  });

  it("carries the theme, so the optimistic cache does not flip it back", () => {
    // The theme is applied to <html> the instant it is picked and only then
    // sent. A patch that dropped it here would leave the query cache saying
    // "system" while the page renders dark, and ThemeSync would adopt the
    // cache's answer and undo the click.
    const next = applySettingsPatch(FALLBACK_SETTINGS, { theme: "dark" });
    expect(next.theme).toBe("dark");
    expect(applySettingsPatch(next, { currency: "USD" }).theme).toBe("dark");
  });
});
