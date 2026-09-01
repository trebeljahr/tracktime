import {
  Action,
  ActionPanel,
  Icon,
  LaunchType,
  List,
  Toast,
  launchCommand,
  showToast,
} from "@raycast/api";
import { ApiError, AuthError } from "@starter/core";
import { NotSignedInError } from "./api.js";
import { webLink } from "./preferences.js";

/**
 * Nudge the menu bar to re-read the timer.
 *
 * Menu bar commands otherwise only refresh on their interval, which would
 * leave the clock showing a timer the user just stopped from a hotkey.
 */
export async function refreshMenuBar(): Promise<void> {
  try {
    await launchCommand({ name: "menu-bar", type: LaunchType.Background });
  } catch {
    // The command is disabled, or Raycast declined to launch it. The menu bar
    // just stays stale until its next tick — not worth surfacing.
  }
}

/** True when the failure means "your token is gone or no longer valid". */
export const isAuthFailure = (error: unknown): boolean =>
  error instanceof NotSignedInError ||
  error instanceof AuthError ||
  (error instanceof ApiError &&
    (error.httpStatus === 401 || error.code === "UNAUTHORIZED"));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One place that turns any thrown value into a toast the user can act on. */
export async function showFailureToast(
  error: unknown,
  title: string,
): Promise<void> {
  if (isAuthFailure(error)) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Not signed in",
      message: "Run “Sign in to tracktime” to pair this Mac.",
      primaryAction: {
        title: "Sign In",
        onAction: () => {
          void launchCommand({ name: "sign-in", type: LaunchType.UserInitiated });
        },
      },
    });
    return;
  }

  await showToast({
    style: Toast.Style.Failure,
    title,
    message: messageOf(error),
  });
}

/** Empty state shown by every view command when there is no session yet. */
export function SignedOutView(): React.JSX.Element {
  return (
    <List>
      <List.EmptyView
        icon={Icon.Key}
        title="Not signed in"
        description="Pair this Mac with your tracktime account to start tracking from Raycast."
        actions={
          <ActionPanel>
            <Action
              title="Sign in to Tracktime"
              icon={Icon.Key}
              onAction={() => {
                void launchCommand({
                  name: "sign-in",
                  type: LaunchType.UserInitiated,
                });
              }}
            />
            <Action.OpenInBrowser
              title="Open Web App"
              url={webLink("/track")}
            />
          </ActionPanel>
        }
      />
    </List>
  );
}
