/** Metadata about a room member. */
export type RoomMember = {
  userId: string;
  displayName: string;
  joinedAt: string;
};

/** Possible statuses for an Item. */
export type ItemStatus = "draft" | "published" | "archived";

/** User theme preference. */
export type ThemePreference = "light" | "dark" | "system";

/** Shape of a user profile (extends better-auth's User). */
export type UserProfile = {
  userId: string;
  avatarUrl?: string;
  bio?: string;
  preferences: {
    theme: ThemePreference;
    notifications: boolean;
  };
};

/** Shape of an Item (example CRUD entity). */
export type Item = {
  id: string;
  title: string;
  description?: string;
  status: ItemStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

// ── tracktime domain ─────────────────────────────────────────────────
//
// Every document is scoped by `ownerId` so multi-user can be added later
// without a migration. All ids are stringified Mongo ObjectIds and every
// timestamp crosses the wire as an ISO string — never a Date object.

/** Where a time entry was created. */
export type EntrySource = "web" | "desktop" | "mobile" | "api";

/** How durations are rendered ("1:23:45" vs "1.40 h"). */
export type DurationFormat = "hms" | "decimal";

/** How clock times are rendered. */
export type TimeFormat = "12h" | "24h";

/** First day of the week — 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

/** Dimensions a summary report can be grouped by. */
export type ReportGroupBy =
  | "project"
  | "client"
  | "task"
  | "day"
  | "week"
  | "month";

/** A billable customer that projects belong to. */
export type Client = {
  id: string;
  ownerId: string;
  name: string;
  /** Hex color, e.g. "#4f46e5". */
  color: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A project that time is tracked against. */
export type Project = {
  id: string;
  ownerId: string;
  name: string;
  /** Hex color, e.g. "#4f46e5". */
  color: string;
  clientId: string | null;
  billableDefault: boolean;
  /** Overrides `WorkspaceSettings.defaultHourlyRate` when set. */
  hourlyRate: number | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A unit of work inside a project. */
export type Task = {
  id: string;
  ownerId: string;
  projectId: string;
  name: string;
  done: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A tracked block of time. `end === null` means the timer is running. */
export type TimeEntry = {
  id: string;
  ownerId: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  /** ISO datetime. */
  start: string;
  /** ISO datetime, or null while running. */
  end: string | null;
  /** 0 while running — derive live duration from `start` instead. */
  durationSec: number;
  /** Snapshot taken on stop/create so past earnings never shift. */
  hourlyRate: number | null;
  /** Snapshot of the workspace currency at stop/create time. */
  currency: string;
  source: EntrySource;
  createdAt: string;
  updatedAt: string;
};

/** Pomodoro configuration, nested inside workspace settings. */
export type PomodoroSettings = {
  enabled: boolean;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  notify: boolean;
};

/** Per-user workspace preferences. */
export type WorkspaceSettings = {
  userId: string;
  defaultHourlyRate: number;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  weekStartsOn: WeekStart;
  timeFormat: TimeFormat;
  durationFormat: DurationFormat;
  pomodoro: PomodoroSettings;
};

/** A personal access token. The plaintext value is only ever returned once. */
export type ApiToken = {
  id: string;
  ownerId: string;
  name: string;
  /** Short, non-secret prefix used to identify the token in listings. */
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

/** Returned by `tokens.create` — the only time `token` is ever exposed. */
export type CreatedApiToken = ApiToken & { token: string };
