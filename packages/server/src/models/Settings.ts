import mongoose, { Schema, type Document } from "mongoose";
import type {
  DurationFormat,
  PomodoroSettings,
  TimeFormat,
  WeekStart,
  WorkspaceSettings,
} from "@starter/shared";

/** Defaults applied to a workspace the first time its settings are read. */
export const DEFAULT_POMODORO: PomodoroSettings = {
  enabled: false,
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
  notify: true,
};

export const DEFAULT_SETTINGS: Omit<WorkspaceSettings, "userId"> = {
  defaultHourlyRate: 0,
  currency: "EUR",
  weekStartsOn: 1,
  timeFormat: "24h",
  durationFormat: "hms",
  pomodoro: DEFAULT_POMODORO,
};

export interface ISettings extends Document {
  userId: string;
  defaultHourlyRate: number;
  currency: string;
  weekStartsOn: WeekStart;
  timeFormat: TimeFormat;
  durationFormat: DurationFormat;
  pomodoro: PomodoroSettings;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Structural shape accepted by {@link toClientSettings} — satisfied by both a
 * `.lean()` result and a hydrated document.
 */
export type SettingsDocLike = {
  userId: string;
  defaultHourlyRate: number;
  currency: string;
  weekStartsOn: WeekStart;
  timeFormat: TimeFormat;
  durationFormat: DurationFormat;
  pomodoro: PomodoroSettings;
};

const pomodoroSchema = new Schema<PomodoroSettings>(
  {
    enabled: { type: Boolean, required: true, default: DEFAULT_POMODORO.enabled },
    workMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_POMODORO.workMinutes,
    },
    breakMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_POMODORO.breakMinutes,
    },
    longBreakMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_POMODORO.longBreakMinutes,
    },
    cyclesBeforeLongBreak: {
      type: Number,
      required: true,
      default: DEFAULT_POMODORO.cyclesBeforeLongBreak,
    },
    notify: { type: Boolean, required: true, default: DEFAULT_POMODORO.notify },
  },
  { _id: false },
);

const settingsSchema = new Schema<ISettings>(
  {
    userId: { type: String, required: true, unique: true },
    defaultHourlyRate: {
      type: Number,
      required: true,
      default: DEFAULT_SETTINGS.defaultHourlyRate,
      min: 0,
    },
    currency: { type: String, required: true, default: DEFAULT_SETTINGS.currency },
    weekStartsOn: {
      type: Number,
      enum: [0, 1],
      required: true,
      default: DEFAULT_SETTINGS.weekStartsOn,
    },
    timeFormat: {
      type: String,
      enum: ["12h", "24h"],
      required: true,
      default: DEFAULT_SETTINGS.timeFormat,
    },
    durationFormat: {
      type: String,
      enum: ["hms", "decimal"],
      required: true,
      default: DEFAULT_SETTINGS.durationFormat,
    },
    pomodoro: {
      type: pomodoroSchema,
      required: true,
      default: (): PomodoroSettings => ({ ...DEFAULT_POMODORO }),
    },
  },
  { timestamps: true },
);

export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);

/** Convert a Settings document into the exact wire shape. */
export function toClientSettings(doc: SettingsDocLike): WorkspaceSettings {
  return {
    userId: doc.userId,
    defaultHourlyRate: doc.defaultHourlyRate,
    currency: doc.currency,
    weekStartsOn: doc.weekStartsOn,
    timeFormat: doc.timeFormat,
    durationFormat: doc.durationFormat,
    pomodoro: {
      enabled: doc.pomodoro.enabled,
      workMinutes: doc.pomodoro.workMinutes,
      breakMinutes: doc.pomodoro.breakMinutes,
      longBreakMinutes: doc.pomodoro.longBreakMinutes,
      cyclesBeforeLongBreak: doc.pomodoro.cyclesBeforeLongBreak,
      notify: doc.pomodoro.notify,
    },
  };
}

/**
 * Read a user's workspace settings, creating them with defaults on first use.
 * Every rate/currency snapshot in the app funnels through this.
 */
export async function getOrCreateSettings(
  userId: string,
): Promise<WorkspaceSettings> {
  const existing = await Settings.findOne({ userId }).lean();
  if (existing) return toClientSettings(existing);

  await Settings.updateOne(
    { userId },
    { $setOnInsert: { userId, ...DEFAULT_SETTINGS } },
    { upsert: true },
  );

  const created = await Settings.findOne({ userId }).lean();
  return created
    ? toClientSettings(created)
    : { userId, ...DEFAULT_SETTINGS, pomodoro: { ...DEFAULT_POMODORO } };
}
