import { closeMainWindow, open } from "@raycast/api";
import { webLink } from "./lib/preferences.js";
import { showFailureToast } from "./lib/ui.js";

/**
 * Jump to the web app, which is where everything Raycast deliberately does not
 * do lives — reports, invoices, the calendar, and all catalog editing.
 *
 * `/track` rather than `/`: the root redirects through auth, and the tracking
 * page is the one a person means by "the dashboard".
 */
export default async function OpenDashboard(): Promise<void> {
  try {
    await closeMainWindow();
    await open(webLink("/track"));
  } catch (error) {
    await showFailureToast(error, "Could not open the dashboard");
  }
}
