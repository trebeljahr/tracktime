import { LaunchType, launchCommand, showHUD } from "@raycast/api";
import { getTracktime } from "./lib/api.js";
import { formatDurationShort, isoDaysAgo } from "./lib/format.js";
import { entryLabel, RECENT_DAYS } from "./lib/timer-data.js";
import { refreshMenuBar, showFailureToast } from "./lib/ui.js";

/**
 * One hotkey for the whole loop: stop what is running, or pick the last thing
 * up again. With nothing to resume it falls through to the Timer view rather
 * than starting a nameless timer the user then has to fix.
 *
 * This is `no-view` deliberately, and it is why it earns a command of its own
 * rather than living inside `timer`. Raycast can only launch `no-view` and
 * menu bar commands in the background, so this is the only mode a global
 * hotkey can drive without opening a window: press it, see a HUD, keep
 * working. The `timer` view is the surface for choosing *what* to start;
 * this one is for the case where there is nothing to choose.
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

    // The same window the Timer view and the menu bar call "recent", so the
    // entry a hotkey resumes is the one those surfaces show at the top.
    const { entries } = await api.list({
      from: isoDaysAgo(RECENT_DAYS),
      to: new Date().toISOString(),
      limit: 1,
    });
    const last = entries[0];

    if (!last) {
      await launchCommand({ name: "timer", type: LaunchType.UserInitiated });
      return;
    }

    await api.continue(last.id);
    await refreshMenuBar();
    // Labelled from the entry that was continued, not from the one that came
    // back: the list rows are joined with their project and client names, so
    // an entry with no description still reads as something.
    await showHUD(`▶ Started — ${entryLabel(last)}`);
  } catch (error) {
    await showFailureToast(error, "Could not toggle the timer");
  }
}
