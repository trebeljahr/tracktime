import type { JSX } from "react";
import {
  IDLE_BEHAVIORS,
  idleBehaviorDescription,
  idleBehaviorLabel,
  MAX_IDLE_THRESHOLD_MINUTES,
  MIN_IDLE_THRESHOLD_MINUTES,
  type IdleBehavior,
  type ResolvedSettings,
} from "@starter/core";
import type { SettingsPatch } from "../../lib/messaging";
import { NumberField } from "../number-field";
import { Switch } from "../switch";
import { SettingRow } from "../accordion";

/**
 * Idle detection, changed from the device that does the detecting.
 *
 * The labels and the sentence under the behaviour come from
 * `@starter/shared`'s own `idleBehaviorLabel` / `idleBehaviorDescription` and
 * are never retyped here: the web app renders the same four choices, and two
 * hand-written copies of "what pause-and-resume does to your entry" is how the
 * two surfaces end up promising different things.
 *
 * Changing anything in this block obliges the worker to re-run
 * `syncDetectionInterval()` — `chrome.idle`'s detection interval is set once
 * and sticks, so a threshold changed here would otherwise not take effect
 * until the worker was next evicted. That happens in `background/settings.ts`.
 */

export type IdleSectionProps = {
  settings: ResolvedSettings | null;
  onSave: (patch: SettingsPatch) => Promise<boolean>;
};

/** The behaviour, said in one word, for the closed header. */
const SHORT_BEHAVIOR: Record<IdleBehavior, string> = {
  ask: "Ask",
  "pause-and-resume": "Pause",
  "keep-running": "Keep",
  stop: "Stop",
};

export function idleHint(settings: ResolvedSettings | null): string {
  if (settings === null) return "…";
  const { idle } = settings;
  return idle.enabled
    ? `${SHORT_BEHAVIOR[idle.behavior]} after ${idle.thresholdMinutes} min`
    : "Off";
}

export function IdleSection({ settings, onSave }: IdleSectionProps): JSX.Element {
  if (settings === null) {
    return <p className="loading">Loading settings…</p>;
  }

  const { idle } = settings;
  const off = !idle.enabled;

  return (
    <>
      <SettingRow
        note="Each device watches its own input. A device that did not start the timer never touches it."
        testId="setting-idle-enabled"
      >
        <Switch
          checked={idle.enabled}
          onChange={(enabled) => {
            void onSave({ idle: { enabled } });
          }}
          label={idle.enabled ? "Detecting idle time" : "Idle detection off"}
          testId="idle-enabled"
        />
      </SettingRow>

      <SettingRow
        label="Away after"
        htmlFor="setting-idle-threshold"
        note="How long with no input before you count as away."
        testId="setting-idle-threshold"
      >
        <NumberField
          id="setting-idle-threshold"
          value={idle.thresholdMinutes}
          onCommit={(thresholdMinutes) => {
            void onSave({ idle: { thresholdMinutes } });
          }}
          min={MIN_IDLE_THRESHOLD_MINUTES}
          max={MAX_IDLE_THRESHOLD_MINUTES}
          suffix="min"
          disabled={off}
          ariaLabel="Idle threshold in minutes"
          testId="idle-threshold"
        />
      </SettingRow>

      <SettingRow
        label="When away"
        htmlFor="setting-idle-behavior"
        note={idleBehaviorDescription(idle.behavior)}
        testId="setting-idle-behavior"
      >
        <select
          id="setting-idle-behavior"
          className="select"
          value={idle.behavior}
          disabled={off}
          onChange={(event) => {
            void onSave({ idle: { behavior: event.target.value as IdleBehavior } });
          }}
          data-testid="idle-behavior-select"
        >
          {IDLE_BEHAVIORS.map((behavior) => (
            <option key={behavior} value={behavior}>
              {idleBehaviorLabel(behavior)}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        note="Locking is deliberate, so it does not have to wait out the threshold first."
        testId="setting-idle-lock"
      >
        <Switch
          checked={idle.lockIsImmediate}
          onChange={(lockIsImmediate) => {
            void onSave({ idle: { lockIsImmediate } });
          }}
          label={
            idle.lockIsImmediate
              ? "Locking counts immediately"
              : "Locking waits for the threshold"
          }
          disabled={off}
          testId="idle-lock-immediate"
        />
      </SettingRow>
    </>
  );
}
