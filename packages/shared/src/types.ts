/** Metadata about a room member. */
export type RoomMember = {
  userId: string;
  displayName: string;
  joinedAt: string;
};

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

// ── tracktime domain ─────────────────────────────────────────────────
//
// Every document is scoped by `ownerId` so multi-user can be added later
// without a migration. All ids are stringified Mongo ObjectIds and every
// timestamp crosses the wire as an ISO string — never a Date object.

/**
 * Where a time entry was created. The browser extension is its own source
 * rather than folding into "api", so an entry can be traced back to the thing
 * that actually made it; "api" stays the catch-all for third-party callers.
 */
export type EntrySource =
  | "web"
  | "desktop"
  | "mobile"
  | "extension"
  | "api";

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
  /**
   * Lifetime hours the project is estimated at, e.g. 80 for "quoted at two
   * weeks". Null means no estimate — which is not the same as an estimate of
   * zero, and must never render as "0% of 0".
   */
  estimatedHours: number | null;
  /**
   * Lifetime money budget. Null means none was set. Recurring (per-month)
   * budgets are deliberately not modelled — see `budgets.ts`.
   */
  budgetAmount: number | null;
  /**
   * ISO 4217 code `budgetAmount` is denominated in, snapshotted from the
   * workspace currency when the budget was set. Null exactly when
   * `budgetAmount` is null.
   *
   * It is snapshotted for the same reason entries snapshot theirs: changing
   * the workspace currency later must not silently re-denominate a budget
   * that was agreed in the old one.
   */
  budgetCurrency: string | null;
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
  /**
   * IANA zone the entry was recorded in, e.g. "Europe/Berlin".
   *
   * The instants are absolute, so durations never depend on this. It exists so
   * the clock time reads the same wherever the entry is later viewed or edited
   * from: an entry written at 23:30 in Berlin still says 23:30 when opened on a
   * laptop in Tokyo, instead of drifting by the offset between the two.
   *
   * Null on entries recorded before the field existed; callers fall back to the
   * viewer's own zone for those.
   */
  timeZone: string | null;
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
