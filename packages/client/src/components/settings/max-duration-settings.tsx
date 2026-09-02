"use client";

import * as React from "react";
import {
  DEFAULT_MAX_DURATION_SETTINGS,
  MAX_MAX_DURATION_HOURS,
  MIN_MAX_DURATION_HOURS,
  RUNAWAY_BEHAVIORS,
  runawayBehaviorDescription,
  runawayBehaviorLabel,
  type RunawayBehavior,
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

export type MaxDurationSettingsPanelProps = {
  controller: WorkspaceSettingsController;
};

const BEHAVIOR_OPTIONS = RUNAWAY_BEHAVIORS.map((behavior) => ({
  value: behavior,
  label: runawayBehaviorLabel(behavior),
  testId: `runaway-behavior-${behavior}`,
}));

/**
 * The runaway-timer guard.
 *
 * Sibling of the Idle panel, and the copy has to keep saying which is which:
 * idle is "you stopped typing" and needs a device awake to notice, this one is
 * "the laptop was shut all weekend" and is worked out on the server. People
 * who find one of them will look for the other here.
 */
export function MaxDurationSettingsPanel({
  controller,
}: MaxDurationSettingsPanelProps): React.JSX.Element {
  const { settings, saveState, save } = controller;
  const maxDuration = settings.maxDuration;
  const enabled = maxDuration.maxHours > 0;

  // The switch and the field are two views of one number: 0 is off. Turning it
  // back on restores the shipped default rather than the last value, because
  // the last value is exactly the one the person had just decided against.
  const toggle = (next: boolean): void =>
    save({
      maxDuration: {
        maxHours: next ? DEFAULT_MAX_DURATION_SETTINGS.maxHours : 0,
      },
    });

  return (
    <Card data-testid="settings-max-duration">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Maximum entry length</CardTitle>
          <CardDescription>
            Catch the timer you started on Friday evening and found still
            running on Monday morning.
          </CardDescription>
        </div>
        <SaveIndicator state={saveState} testId="max-duration-save-indicator" />
      </CardHeader>
      <CardContent className="divide-y divide-border py-0">
        <SettingRow
          title="Guard against runaway timers"
          description="Worked out on the server, not on your devices — the whole point is the case where none of them were running."
          testId="setting-max-duration-enabled"
        >
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Guard against runaway timers"
            data-testid="max-duration-enabled"
          />
        </SettingRow>

        <SettingRow
          title="Longer than"
          htmlFor="max-duration-hours"
          description="Pick something above any believable single sitting and below an overnight."
          testId="setting-max-duration-hours"
        >
          <NumberField
            id="max-duration-hours"
            value={
              enabled
                ? maxDuration.maxHours
                : DEFAULT_MAX_DURATION_SETTINGS.maxHours
            }
            onCommit={(maxHours) => save({ maxDuration: { maxHours } })}
            min={MIN_MAX_DURATION_HOURS}
            max={MAX_MAX_DURATION_HOURS}
            suffix="h"
            disabled={!enabled}
            testId="max-duration-hours"
            aria-label="Maximum entry length in hours"
          />
        </SettingRow>

        <SettingRow
          title="When one runs that long"
          description={runawayBehaviorDescription(maxDuration.behavior)}
          testId="setting-max-duration-behavior"
        >
          <OptionGroup
            label="When one runs that long"
            className="flex-wrap"
            value={maxDuration.behavior}
            options={BEHAVIOR_OPTIONS}
            disabled={!enabled}
            onChange={(behavior: RunawayBehavior) =>
              save({ maxDuration: { behavior } })
            }
          />
        </SettingRow>

        <SettingRow
          title="Nothing is deleted for good"
          description="A capped entry keeps the span it actually ran, so “put it back” is always one click away in the prompt."
          testId="setting-max-duration-undo"
        >
          <span className="text-sm text-muted-foreground">Always</span>
        </SettingRow>
      </CardContent>
    </Card>
  );
}
