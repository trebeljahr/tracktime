import { showHUD } from "@raycast/api";
import { ApiError } from "@starter/core";
import { getTracktime } from "./lib/api.js";
import { formatDurationShort } from "./lib/format.js";
import { refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** Stop the running timer and keep the entry. Bound to a hotkey, usually. */
export default async function StopTimer(): Promise<void> {
  try {
    const api = await getTracktime();
    const entry = await api.stop();
    await refreshMenuBar();
    await showHUD(
      `⏹ Stopped — ${formatDurationShort(entry.durationSec)}${
        entry.description ? ` · ${entry.description}` : ""
      }`,
    );
  } catch (error) {
    // "Nothing was running" is a normal outcome for a hotkey, not a failure.
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      await refreshMenuBar();
      await showHUD("No timer running");
      return;
    }
    await showFailureToast(error, "Could not stop the timer");
  }
}
