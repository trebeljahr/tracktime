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

/**
 * Which tracktime client a session was created from. Set by the client
 * itself (`x-tracktime-client` header, or the device-flow `client_id`), so
 * treat it as a label, never as a permission.
 */
export type ClientKind =
  | "web"
  | "desktop"
  | "mobile"
  | "raycast"
  | "extension"
  | "cli"
  | "unknown";

/**
 * One signed-in device or app, as shown in Settings → Devices. This is a
 * projection of a better-auth session: the session token itself is secret and
 * never crosses the wire — `id` is what the revoke call takes.
 */
export type DeviceSession = {
  id: string;
  /** Human label, e.g. "Raycast on macOS" or "Chrome on macOS". */
  name: string;
  client: ClientKind;
  /** Raw user agent, kept for the "is this really me?" case. */
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  /** better-auth refreshes this as the session is used. */
  updatedAt: string;
  expiresAt: string;
  /** True for the session making the request — it cannot be revoked blindly. */
  current: boolean;
};
