import { LaunchType, launchCommand, showHUD } from "@raycast/api";
import { getTracktime } from "./lib/api.js";
import { formatDurationShort, isoDaysAgo } from "./lib/format.js";
import { refreshMenuBar, showFailureToast } from "./lib/ui.js";

/** How far back to look for something to resume. */
const RESUME_DAYS = 7;

/**
 * One hotkey for the whole loop: stop what is running, or pick the last thing
 * up again. With nothing to resume it falls through to the start form rather
 * than starting a nameless timer the user then has to fix.
 */
export default async function ToggleTimer(): Promise<void> {
  try {
    const api = await getTracktime();
    const running = await api.current();

    if (running) {
      const stopped = await api.stop(running.id);
      await refreshMenuBar();
      await showHUD(
        `⏹ Stopped — ${formatDurationShort(stopped.durationSec)}${
          stopped.description ? ` · ${stopped.description}` : ""
        }`,
      );
      return;
    }

    const { entries } = await api.list({
      from: isoDaysAgo(RESUME_DAYS),
      to: new Date().toISOString(),
      limit: 1,
    });
    const last = entries[0];

    if (!last) {
      await launchCommand({
        name: "start-timer",
        type: LaunchType.UserInitiated,
      });
      return;
    }

    const started = await api.continue(last.id);
    await refreshMenuBar();
    await showHUD(`▶ Started — ${started.description || "No description"}`);
  } catch (error) {
    await showFailureToast(error, "Could not toggle the timer");
  }
}
