import type { JSX } from "react";
import {
  formatDuration,
  type DurationFormat,
  type ResolvedSettings,
  type ThemePreference,
  type TimeFormat,
  type WeekStart,
} from "@starter/core";
import type { SettingsPatch } from "../../lib/messaging";
import { NumberField } from "../number-field";
import { SettingRow } from "../accordion";

/**
 * Clock, duration, week, money.
 *
 * The last three are WORKSPACE fields, and `settings.update` refuses them with
 * FORBIDDEN when the caller's membership role is "member". They are rendered
 * anyway, unconditionally and enabled, for two reasons: no procedure the
 * extension can reach exposes the caller's role, so gating would mean
 * inventing one; and the refusal costs nothing, because
 * `background/settings.ts` writes the settings cache only from a *successful*
 * mutation — the next three-second snapshot re-renders the old value with no
 * rollback code, and the server's own sentence lands in the screen's banner.
 *
 * A personal workspace's single member is its owner, so a solo user never
 * meets it at all.
 */

export type GeneralSectionProps = {
  settings: ResolvedSettings | null;
  onSave: (patch: SettingsPatch) => Promise<boolean>;
};

const THEMES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "Match the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const TIME_FORMATS: ReadonlyArray<{ value: TimeFormat; label: string }> = [
  { value: "24h", label: "24-hour" },
  { value: "12h", label: "12-hour" },
];

const DURATION_FORMATS: ReadonlyArray<{ value: DurationFormat; label: string }> = [
  { value: "hms", label: "1:30:00" },
  { value: "decimal", label: "1.50 h" },
];

const WEEK_STARTS: ReadonlyArray<{ value: "0" | "1"; label: string }> = [
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
];

/** ISO 4217 codes offered in the picker. Any 3-letter code is valid server-side. */
const CURRENCIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "EUR", label: "Euro" },
  { code: "USD", label: "US Dollar" },
  { code: "GBP", label: "British Pound" },
  { code: "CHF", label: "Swiss Franc" },
  { code: "SEK", label: "Swedish Krona" },
  { code: "NOK", label: "Norwegian Krone" },
  { code: "DKK", label: "Danish Krone" },
  { code: "PLN", label: "Polish Zloty" },
  { code: "CZK", label: "Czech Koruna" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "NZD", label: "New Zealand Dollar" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "SGD", label: "Singapore Dollar" },
  { code: "HKD", label: "Hong Kong Dollar" },
  { code: "INR", label: "Indian Rupee" },
  { code: "BRL", label: "Brazilian Real" },
  { code: "MXN", label: "Mexican Peso" },
  { code: "ZAR", label: "South African Rand" },
];

const WORKSPACE_NOTE = "Applies to the whole workspace";

/** The closed header's summary: "24-hour · 1:30:00 · EUR". */
export function generalHint(settings: ResolvedSettings | null): string {
  if (settings === null) return "…";
  const clock = settings.timeFormat === "12h" ? "12-hour" : "24-hour";
  return `${clock} · ${formatDuration(5400, settings.durationFormat)} · ${settings.currency}`;
}

export function GeneralSection({
  settings,
  onSave,
}: GeneralSectionProps): JSX.Element {
  if (settings === null) {
    return <p className="loading">Loading settings…</p>;
  }

  // A currency the workspace already uses but that is not in the curated list
  // must still be selectable, or the <select> would silently drop it — and
  // picking any other option would then be the only way to leave the field.
  const currencies = CURRENCIES.some((item) => item.code === settings.currency)
    ? CURRENCIES
    : [{ code: settings.currency, label: settings.currency }, ...CURRENCIES];

  return (
    <>
      <SettingRow
        label="Theme"
        htmlFor="setting-theme"
        note="Shared with the web app and your other machines."
        testId="setting-theme"
      >
        <select
          id="setting-theme"
          className="select"
          value={settings.theme}
          onChange={(event) => {
            // Not applied here: the popup follows `state.settings.theme`, so
            // the successful mutation's snapshot is what repaints it — and a
            // refusal therefore leaves the theme where it really is rather
            // than where the <select> briefly said it was.
            void onSave({ theme: event.target.value as ThemePreference });
          }}
          data-testid="theme-select"
        >
          {THEMES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Time format"
        htmlFor="setting-time-format"
        testId="setting-time-format"
      >
        <select
          id="setting-time-format"
          className="select"
          value={settings.timeFormat}
          onChange={(event) => {
            void onSave({ timeFormat: event.target.value as TimeFormat });
          }}
          data-testid="time-format-select"
        >
          {TIME_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Duration format"
        htmlFor="setting-duration-format"
        note="Decimal hours are what most invoices expect."
        testId="setting-duration-format"
      >
        <select
          id="setting-duration-format"
          className="select"
          value={settings.durationFormat}
          onChange={(event) => {
            void onSave({
              durationFormat: event.target.value as DurationFormat,
            });
          }}
          data-testid="duration-format-select"
        >
          {DURATION_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Week starts on"
        htmlFor="setting-week-start"
        note={WORKSPACE_NOTE}
        testId="setting-week-start"
      >
        <select
          id="setting-week-start"
          className="select"
          value={settings.weekStartsOn === 0 ? "0" : "1"}
          onChange={(event) => {
            // Sent as a number: the schema is a union of the literals 0 and 1,
            // and rejects the string an <option> value always is.
            const weekStartsOn: WeekStart = event.target.value === "0" ? 0 : 1;
            void onSave({ weekStartsOn });
          }}
          data-testid="week-start-select"
        >
          {WEEK_STARTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Currency"
        htmlFor="setting-currency"
        note={WORKSPACE_NOTE}
        testId="setting-currency"
      >
        <select
          id="setting-currency"
          className="select"
          value={settings.currency}
          onChange={(event) => {
            // Uppercased here because this schema's regex is /^[A-Z]{3}$/ and,
            // unlike `currencyCodeSchema`, does not transform for you.
            void onSave({ currency: event.target.value.toUpperCase() });
          }}
          data-testid="currency-select"
        >
          {currencies.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code} — {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Default hourly rate"
        htmlFor="setting-default-rate"
        note={`Used when a billable entry's project has no rate of its own. ${WORKSPACE_NOTE.toLowerCase()}.`}
        testId="setting-default-rate"
      >
        <NumberField
          id="setting-default-rate"
          value={settings.defaultHourlyRate}
          onCommit={(defaultHourlyRate) => {
            void onSave({ defaultHourlyRate });
          }}
          min={0}
          max={1_000_000}
          step={0.01}
          suffix={settings.currency}
          ariaLabel="Default hourly rate"
          testId="default-hourly-rate"
        />
      </SettingRow>
    </>
  );
}
