import type { JSX } from "react";
import {
  DEFAULT_MAX_DURATION_SETTINGS,
  isRunawayGuardOn,
  MAX_MAX_DURATION_HOURS,
  MIN_MAX_DURATION_HOURS,
  RUNAWAY_BEHAVIORS,
  runawayBehaviorDescription,
  runawayBehaviorLabel,
  type ResolvedSettings,
  type RunawayBehavior,
} from "@starter/core";
import type { SettingsPatch } from "../../lib/messaging";
import { NumberField } from "../number-field";
import { Switch } from "../switch";
import { SettingRow } from "../accordion";

/**
 * The runaway-timer guard.
 *
 * There is no `enabled` flag anywhere in the model: `maxHours: 0` IS the off
 * switch, read back with `isRunawayGuardOn`. Two ways to disable one feature
 * would be two things to keep in step, and the number alone already answers
 * "after how long", including "never".
 *
 * The trap that follows from it: `maxHours` must never be tested for
 * truthiness, because 0 is both a legal value and the falsy one. Everything
 * here goes through `isRunawayGuardOn`, and the switch writes the default
 * back rather than a boolean.
 *
 * Evaluated on the server, not here — the case this guard exists for is the
 * Friday-evening timer found on Monday, where no client was running at all.
 */

export type LimitsSectionProps = {
  settings: ResolvedSettings | null;
  onSave: (patch: SettingsPatch) => Promise<boolean>;
};

/** What the number field shows while the guard is off, so it is not blank. */
const PLACEHOLDER_HOURS = DEFAULT_MAX_DURATION_SETTINGS.maxHours;

const SHORT_BEHAVIOR: Record<RunawayBehavior, string> = {
  ask: "ask",
  cap: "cap it",
  stop: "stop it",
};

export function limitsHint(settings: ResolvedSettings | null): string {
  if (settings === null) return "…";
  const { maxDuration } = settings;
  return isRunawayGuardOn(maxDuration)
    ? `${maxDuration.maxHours} h, then ${SHORT_BEHAVIOR[maxDuration.behavior]}`
    : "Off";
}

export function LimitsSection({
  settings,
  onSave,
}: LimitsSectionProps): JSX.Element {
  if (settings === null) {
    return <p className="loading">Loading settings…</p>;
  }

  const { maxDuration } = settings;
  const on = isRunawayGuardOn(maxDuration);

  return (
    <>
      <SettingRow
        note="Worked out on the server, not on your devices — the whole point is the case where none of them were running."
        testId="setting-limits-enabled"
      >
        <Switch
          checked={on}
          onChange={(next) => {
            void onSave({
              maxDuration: {
                maxHours: next ? DEFAULT_MAX_DURATION_SETTINGS.maxHours : 0,
              },
            });
          }}
          label={on ? "Stopping runaway timers" : "Runaway guard off"}
          testId="limits-enabled"
        />
      </SettingRow>

      <SettingRow
        label="After"
        htmlFor="setting-limits-hours"
        note="Pick something above any believable single sitting and below an overnight."
        testId="setting-limits-hours"
      >
        <NumberField
          id="setting-limits-hours"
          value={on ? maxDuration.maxHours : PLACEHOLDER_HOURS}
          onCommit={(maxHours) => {
            void onSave({ maxDuration: { maxHours } });
          }}
          min={MIN_MAX_DURATION_HOURS}
          max={MAX_MAX_DURATION_HOURS}
          suffix="h"
          disabled={!on}
          ariaLabel="Maximum entry length in hours"
          testId="limits-max-hours"
        />
      </SettingRow>

      <SettingRow
        label="Then"
        htmlFor="setting-limits-behavior"
        note={runawayBehaviorDescription(maxDuration.behavior)}
        testId="setting-limits-behavior"
      >
        <select
          id="setting-limits-behavior"
          className="select"
          value={maxDuration.behavior}
          disabled={!on}
          onChange={(event) => {
            void onSave({
              maxDuration: { behavior: event.target.value as RunawayBehavior },
            });
          }}
          data-testid="limits-behavior-select"
        >
          {RUNAWAY_BEHAVIORS.map((behavior) => (
            <option key={behavior} value={behavior}>
              {runawayBehaviorLabel(behavior)}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  );
}
