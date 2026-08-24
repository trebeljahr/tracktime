"use client";

import * as React from "react";
import { Bell, BellOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { NumberField } from "@/components/settings/number-field";
import { SaveIndicator, SettingRow } from "@/components/settings/setting-row";
import type { WorkspaceSettingsController } from "@/components/settings/use-workspace-settings";

export type PomodoroSettingsPanelProps = {
  controller: WorkspaceSettingsController;
};

type PermissionLabel = NotificationPermission | "unsupported";

/**
 * Requests permission from inside the click handler — browsers reject
 * `Notification.requestPermission()` that isn't tied to a user gesture.
 */
const requestAndNotify = async (
  body: string
): Promise<PermissionLabel> => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission === "granted") {
    new Notification("Pomodoro finished", {
      body,
      tag: "tracktime-pomodoro-test",
    });
  }
  return permission;
};

/** Focus-cycle configuration plus a way to prove notifications work. */
export function PomodoroSettingsPanel({
  controller,
}: PomodoroSettingsPanelProps): React.JSX.Element {
  const { settings, saveState, save } = controller;
  const pomodoro = settings.pomodoro;
  // Deliberately left unknown until the user clicks: reading
  // `Notification.permission` during the first render would desync hydration.
  const [permission, setPermission] = React.useState<PermissionLabel | null>(
    null
  );
  const [testing, setTesting] = React.useState(false);

  const handleTest = (): void => {
    setTesting(true);
    void requestAndNotify(
      `Take a ${pomodoro.breakMinutes}-minute break — this is a sample.`
    )
      .then((result) => {
        setPermission(result);
        if (result === "unsupported") {
          toast.error("This browser does not support desktop notifications.");
        } else if (result === "granted") {
          toast.success("Sample notification sent.");
        } else if (result === "denied") {
          toast.error(
            "Notifications are blocked for this site. Enable them in your browser settings."
          );
        } else {
          toast.message("Notification permission was dismissed.");
        }
      })
      .finally(() => {
        setTesting(false);
      });
  };

  return (
    <Card data-testid="settings-pomodoro">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Pomodoro</CardTitle>
          <CardDescription>
            Break the running timer into focus cycles with reminders in
            between.
          </CardDescription>
        </div>
        <SaveIndicator state={saveState} testId="pomodoro-save-indicator" />
      </CardHeader>
      <CardContent className="divide-y divide-border py-0">
        <SettingRow
          title="Enable pomodoro"
          description="Adds cycle controls to the tracker bar."
          testId="setting-pomodoro-enabled"
        >
          <Switch
            checked={pomodoro.enabled}
            onCheckedChange={(enabled) => save({ pomodoro: { enabled } })}
            aria-label="Enable pomodoro"
            data-testid="pomodoro-enabled"
          />
        </SettingRow>

        <SettingRow
          title="Focus length"
          htmlFor="pomodoro-work-minutes"
          testId="setting-pomodoro-work"
        >
          <NumberField
            id="pomodoro-work-minutes"
            value={pomodoro.workMinutes}
            onCommit={(workMinutes) => save({ pomodoro: { workMinutes } })}
            min={1}
            max={180}
            suffix="min"
            testId="pomodoro-work-minutes"
            aria-label="Focus length in minutes"
          />
        </SettingRow>

        <SettingRow
          title="Break length"
          htmlFor="pomodoro-break-minutes"
          testId="setting-pomodoro-break"
        >
          <NumberField
            id="pomodoro-break-minutes"
            value={pomodoro.breakMinutes}
            onCommit={(breakMinutes) => save({ pomodoro: { breakMinutes } })}
            min={1}
            max={120}
            suffix="min"
            testId="pomodoro-break-minutes"
            aria-label="Break length in minutes"
          />
        </SettingRow>

        <SettingRow
          title="Long break length"
          htmlFor="pomodoro-long-break-minutes"
          testId="setting-pomodoro-long-break"
        >
          <NumberField
            id="pomodoro-long-break-minutes"
            value={pomodoro.longBreakMinutes}
            onCommit={(longBreakMinutes) =>
              save({ pomodoro: { longBreakMinutes } })
            }
            min={1}
            max={180}
            suffix="min"
            testId="pomodoro-long-break-minutes"
            aria-label="Long break length in minutes"
          />
        </SettingRow>

        <SettingRow
          title="Cycles before a long break"
          htmlFor="pomodoro-cycles"
          description={`After ${pomodoro.cyclesBeforeLongBreak} focus blocks you get the long break instead.`}
          testId="setting-pomodoro-cycles"
        >
          <NumberField
            id="pomodoro-cycles"
            value={pomodoro.cyclesBeforeLongBreak}
            onCommit={(cyclesBeforeLongBreak) =>
              save({ pomodoro: { cyclesBeforeLongBreak } })
            }
            min={1}
            max={12}
            testId="pomodoro-cycles"
            aria-label="Cycles before a long break"
          />
        </SettingRow>

        <SettingRow
          title="Desktop notifications"
          description="Notify when a focus block or break ends."
          testId="setting-pomodoro-notify"
        >
          <Switch
            checked={pomodoro.notify}
            onCheckedChange={(notify) => save({ pomodoro: { notify } })}
            aria-label="Desktop notifications"
            data-testid="pomodoro-notify"
          />
        </SettingRow>

        <SettingRow
          title="Test notification"
          description="Asks your browser for permission, then sends a sample."
          testId="setting-pomodoro-test"
        >
          <div className="flex items-center gap-2 sm:justify-end">
            {permission !== null && permission !== "granted" ? (
              <Badge
                variant={permission === "denied" ? "destructive" : "secondary"}
                data-testid="notification-permission"
              >
                <BellOff className="mr-1 size-3" />
                {permission === "denied"
                  ? "Blocked"
                  : permission === "unsupported"
                    ? "Unsupported"
                    : "Not granted"}
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={handleTest}
              data-testid="test-notification"
            >
              <Bell className="size-4" />
              Test notification
            </Button>
          </div>
        </SettingRow>
      </CardContent>
    </Card>
  );
}
