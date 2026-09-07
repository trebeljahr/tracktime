"use client";

import * as React from "react";
import {
  DEFAULT_IDLE_SETTINGS,
  DEFAULT_MAX_DURATION_SETTINGS,
  entryDurationSec,
  formatDuration,
  formatDurationShort,
  type DurationEntry,
  type DurationFormat,
  type TimeFormat,
  type WeekStart,
  type ResolvedSettings,
} from "@starter/shared";
import { trpc } from "@/lib/trpc";

/** Used until `settings.get` resolves, so nothing renders blank on first paint. */
export const FALLBACK_SETTINGS: ResolvedSettings = {
  workspaceId: "",
  userId: "",
  defaultHourlyRate: 0,
  currency: "EUR",
  weekStartsOn: 1,
  timeFormat: "24h",
  durationFormat: "hms",
  idle: DEFAULT_IDLE_SETTINGS,
  maxDuration: DEFAULT_MAX_DURATION_SETTINGS,
};

/** Currency formatting, memoized — `Intl.NumberFormat` construction is costly. */
const moneyFormatters = new Map<string, Intl.NumberFormat>();

const moneyFormatter = (currency: string): Intl.NumberFormat => {
  const key = currency.toUpperCase();
  const cached = moneyFormatters.get(key);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: key,
      maximumFractionDigits: 2,
    });
  } catch {
    // Unknown/invalid ISO code — fall back to a plain decimal with a suffix.
    formatter = new Intl.NumberFormat(undefined, {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  moneyFormatters.set(key, formatter);
  return formatter;
};

const isValidCurrency = (currency: string): boolean =>
  /^[A-Za-z]{3}$/.test(currency);

/** "€1,234.50". Falls back to "1,234.50 XYZ" for codes Intl rejects. */
export const formatMoney = (amount: number, currency: string): string => {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (!isValidCurrency(currency)) {
    return `${moneyFormatter("__invalid").format(safeAmount)} ${currency}`.trim();
  }
  return moneyFormatter(currency).format(safeAmount);
};

/** Clock time of an ISO timestamp in the user's 12h/24h preference. */
export const formatClock = (
  iso: string,
  timeFormat: TimeFormat = "24h"
): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: timeFormat === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
};

/** Calendar date of an ISO timestamp, e.g. "Fri, 21 Aug". */
export const formatDayLabel = (iso: string): string => {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

export type FormatSettings = {
  settings: ResolvedSettings;
  /** False while `settings.get` is still in flight (fallbacks are in use). */
  isLoaded: boolean;
  currency: string;
  timeFormat: TimeFormat;
  durationFormat: DurationFormat;
  weekStartsOn: WeekStart;
  /** "1:23:45" or "1.40 h", per the user's duration preference. */
  duration: (seconds: number) => string;
  /** Compact form — "1h 23m". Never affected by the duration preference. */
  durationShort: (seconds: number) => string;
  /** Live duration of an entry, running entries measured against `nowMs`. */
  entryDuration: (entry: DurationEntry, nowMs?: number) => number;
  money: (amount: number) => string;
  clock: (iso: string) => string;
};

/**
 * Formatting bound to the signed-in user's workspace settings.
 *
 * Every screen renders durations and money through this hook so a change to
 * `durationFormat` or `currency` reaches the whole app from one place.
 */
export const useFormatSettings = (): FormatSettings => {
  const query = trpc.settings.get.useQuery(undefined, {
    staleTime: 60_000,
  });

  const settings = query.data ?? FALLBACK_SETTINGS;
  const { currency, timeFormat, durationFormat, weekStartsOn } = settings;

  return React.useMemo<FormatSettings>(
    () => ({
      settings,
      isLoaded: query.data !== undefined,
      currency,
      timeFormat,
      durationFormat,
      weekStartsOn,
      duration: (seconds) => formatDuration(seconds, durationFormat),
      durationShort: (seconds) => formatDurationShort(seconds),
      entryDuration: (entry, nowMs = Date.now()) =>
        entryDurationSec(entry, nowMs),
      money: (amount) => formatMoney(amount, currency),
      clock: (iso) => formatClock(iso, timeFormat),
    }),
    [settings, query.data, currency, timeFormat, durationFormat, weekStartsOn]
  );
};
