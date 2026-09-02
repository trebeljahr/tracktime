"use client";

import * as React from "react";
import {
  IDLE_BEHAVIORS,
  MAX_IDLE_THRESHOLD_MINUTES,
  MIN_IDLE_THRESHOLD_MINUTES,
  idleBehaviorDescription,
  idleBehaviorLabel,
  type IdleBehavior,
} from "@starter/shared";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NumberField } from "@/components/settings/number-field";
import { OptionGroup } from "@/components/settings/option-group";
import { SaveIndicator, SettingRow } from "@/components/settings/setting-row";
import type { WorkspaceSettingsController } from "@/components/settings/use-workspace-settings";

export type IdleSettingsPanelProps = {
  controller: WorkspaceSettingsController;
};

const BEHAVIOR_OPTIONS = IDLE_BEHAVIORS.map((behavior) => ({
  value: behavior,
  label: idleBehaviorLabel(behavior),
  testId: `idle-behavior-${behavior}`,
}));

/**
 * What happens when a device notices nobody is at it.
 *
 * The copy carries two warnings on purpose. Two of the four behaviours shorten
 * the running entry without asking, and detection is per-device while the timer
 * is not — both are surprising enough that finding out by losing an afternoon
 * would be the wrong way to learn them.
 */
export function IdleSettingsPanel({
  controller,
}: IdleSettingsPanelProps): React.JSX.Element {
  const { settings, saveState, save } = controller;
  const idle = settings.idle;

  return (
    <Card data-testid="settings-idle">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Idle detection</CardTitle>
          <CardDescription>
            Notice when you have stopped working and decide what the running
            timer should do about it.
          </CardDescription>
        </div>
        <SaveIndicator state={saveState} testId="idle-save-indicator" />
      </CardHeader>
      <CardContent className="divide-y divide-border py-0">
        <SettingRow
          title="Detect idle time"
          description="Each device watches its own input. A device that did not start the timer never touches it, so a sleeping laptop cannot pause work you are doing somewhere else."
          testId="setting-idle-enabled"
        >
          <Switch
            checked={idle.enabled}
            onCheckedChange={(enabled) => save({ idle: { enabled } })}
            aria-label="Detect idle time"
            data-testid="idle-enabled"
          />
        </SettingRow>

        <SettingRow
          title="Idle after"
          htmlFor="idle-threshold"
          description="How long with no input before you count as away."
          testId="setting-idle-threshold"
        >
          <NumberField
            id="idle-threshold"
            value={idle.thresholdMinutes}
            onCommit={(thresholdMinutes) => save({ idle: { thresholdMinutes } })}
            min={MIN_IDLE_THRESHOLD_MINUTES}
            max={MAX_IDLE_THRESHOLD_MINUTES}
            suffix="min"
            disabled={!idle.enabled}
            testId="idle-threshold"
            aria-label="Idle threshold in minutes"
          />
        </SettingRow>

        <SettingRow
          title="When you go idle"
          description={idleBehaviorDescription(idle.behavior)}
          testId="setting-idle-behavior"
        >
          <OptionGroup
            label="When you go idle"
            className="flex-wrap"
            value={idle.behavior}
            options={BEHAVIOR_OPTIONS}
            disabled={!idle.enabled}
            onChange={(behavior: IdleBehavior) => save({ idle: { behavior } })}
          />
        </SettingRow>

        <SettingRow
          title="Treat a locked screen as away"
          description="Locking is deliberate, so it does not have to wait out the threshold first."
          testId="setting-idle-lock"
        >
          <Switch
            checked={idle.lockIsImmediate}
            onCheckedChange={(lockIsImmediate) =>
              save({ idle: { lockIsImmediate } })
            }
            disabled={!idle.enabled}
            aria-label="Treat a locked screen as away"
            data-testid="idle-lock-immediate"
          />
        </SettingRow>

        <SettingRow
          title="Per-project override"
          description="Projects can pick their own behaviour in the project dialog — set “Keep running” on the ones where no typing is normal, like meetings or reading."
          testId="setting-idle-projects"
        >
          <span className="text-sm text-muted-foreground">
            Catalog → Projects
          </span>
        </SettingRow>
      </CardContent>
    </Card>
  );
}
