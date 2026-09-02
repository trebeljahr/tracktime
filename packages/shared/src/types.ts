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
// Every document is scoped by `workspaceId` — a better-auth organization id.
// Scope ("who may see this") and authorship ("who tracked this") are separate
// axes: `TimeEntry.authorId` is load-bearing, while the catalog's `createdBy`
// is audit only. All ids are strings and every timestamp crosses the wire as
// an ISO string — never a Date object.

/**
 * A workspace is one better-auth organization. Solo users get a personal
 * workspace at signup, so there is never a "no workspace" state and never a
 * solo-vs-team branch in a query.
 */
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

/**
 * Roles come from better-auth's organization plugin. They gate *membership*
 * actions (invite, remove, delete). They deliberately do NOT gate what a
 * member can see — that is the two flags on WorkspaceMember, so that
 * "hours are transparent, rates are not" is representable.
 */
export type WorkspaceRole = "owner" | "admin" | "member";

/**
 * App-owned membership record, sibling to better-auth's `member` collection.
 *
 * Business data (a billing rate, visibility) lives here rather than as
 * additional fields on the plugin's collection, so the plugin never becomes
 * the schema owner for money.
 */
export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** Display name, denormalized so reports can group by member without
   * reaching into better-auth's user collection mid-aggregation. */
  name: string;
  /**
   * Highest-priority rung of rate resolution, once Stage 7 wires it up.
   * Present and nullable from the first migration so there is never a second
   * one; until then the resolution stays project ?? workspace-default.
   */
  hourlyRate: number | null;
  /** May see other members' entries at all. */
  canViewOthersTime: boolean;
  /** May see other members' hourlyRate and amounts. Strictly narrower. */
  canViewOthersMoney: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * What one caller is allowed to see of one workspace, resolved once per
 * request and threaded into every report builder, the entry list and the
 * sync fan-out. Never re-derived at a call site.
 */
export type Visibility = {
  /** The caller — always fully visible to themselves. */
  userId: string;
  canViewOthersTime: boolean;
  canViewOthersMoney: boolean;
};

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
  workspaceId: string;
  /** Audit only — never used for scoping. */
  createdBy: string;
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
  workspaceId: string;
  /** Audit only — never used for scoping. */
  createdBy: string;
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
  /**
   * Overrides `UserPreferences.idle.behavior` for entries on this project;
   * null inherits it. This is what "Meetings" and "Reading" are for — projects
   * where no keyboard input is the normal case, not a sign of absence.
   *
   * It never switches detection *on*: a workspace with idle disabled stays
   * disabled everywhere.
   */
  idleBehavior: IdleBehavior | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A unit of work inside a project. */
export type Task = {
  id: string;
  workspaceId: string;
  /** Audit only — never used for scoping. */
  createdBy: string;
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
  workspaceId: string;
  /**
   * Who tracked this. Load-bearing, unlike the catalog's `createdBy`: it is
   * the report grouping key, the money-visibility subject, and the key of the
   * one-running-timer index.
   */
  authorId: string;
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
  /**
   * What the runaway-timer guard did about this entry, or null if it never
   * looked at it. See `runaway.ts` — it is kept after the fact on purpose, so
   * a cap can be seen, explained and put back.
   */
  runaway: RunawayMark | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * What to do when a device notices the person at it has stopped giving input.
 *
 * `ask` is the default and the only behaviour that cannot lose time: the timer
 * keeps running until the answer arrives. The other three are opt-in, and two
 * of them shorten the running entry, which is exactly why they are a choice
 * rather than a threshold.
 */
export type IdleBehavior =
  /** Keep running and offer the choice — discard the idle span, or keep it. */
  | "ask"
  /** End the entry at the idle start, reopen an identical one on return. */
  | "pause-and-resume"
  /** Never act. For work that legitimately produces no input. */
  | "keep-running"
  /** End the entry at the idle start and stay stopped. */
  | "stop";

/**
 * Idle-detection configuration, nested inside a person's preferences.
 *
 * Detection is per-device; this is the shared policy every device applies to
 * its own signal. See `@starter/core/idle` for the rule that keeps one sleeping
 * laptop from pausing a timer the person is still driving from another machine.
 */
export type IdleSettings = {
  enabled: boolean;
  /** Minutes without input before the device considers the person away. */
  thresholdMinutes: number;
  behavior: IdleBehavior;
  /**
   * Treat a locked screen as away immediately, without waiting out the
   * threshold. Locking is deliberate in a way that "no keys pressed" is not.
   */
  lockIsImmediate: boolean;
};

/**
 * What to do about an entry that has been running longer than any single
 * sitting plausibly lasts.
 *
 * `ask` is the default and the only behaviour that cannot lose time. The
 * other two both close the entry, and they differ in what happens to the
 * overrun: `cap` throws it away, `stop` keeps all of it.
 *
 * There is no `keep-running` member, because `maxHours: 0` already says that
 * and one off-switch is enough.
 */
export type RunawayBehavior =
  /** Flag it and offer the choice. The timer keeps running until answered. */
  | "ask"
  /** End the entry at the maximum, discarding the overrun (recoverably). */
  | "cap"
  /** End the entry where it had got to, keeping every second. */
  | "stop";

/** What the guard actually did, recorded on the entry. */
export type RunawayAction = "flagged" | "capped" | "stopped";

/**
 * The guard's record of one intervention, kept on the entry itself.
 *
 * It exists so that no time is ever silently deleted: `start + elapsedSec`
 * reconstructs the exact span the guard measured, so a cap is always
 * reversible and always explainable. `resolvedAt` is set once the person has
 * answered the prompt; until then every client that shows the entry offers it.
 */
export type RunawayMark = {
  /** ISO datetime the guard evaluated and acted. */
  detectedAt: string;
  /** Seconds the entry had already been running when the guard noticed. */
  elapsedSec: number;
  /** The maximum in force at that moment, in seconds. */
  limitSec: number;
  action: RunawayAction;
  /** ISO datetime the person answered the prompt, or null while it stands. */
  resolvedAt: string | null;
};

/**
 * Runaway-guard configuration, and a sibling of {@link IdleSettings} in every
 * sense — including living on the person rather than on the workspace.
 *
 * That placement is load-bearing, not copied: the invariant is one running
 * timer per HUMAN across every workspace they belong to, so the entry the
 * guard acts on may be in any of them. A workspace-scoped maximum would mean
 * whichever workspace the timer happened to be started in decides how long a
 * person's day may be, and joining a workspace would silently change the rule.
 *
 * Evaluated on the server, not on a client — in the case this guard exists
 * for, no client is running. See `runaway.ts`.
 */
export type MaxDurationSettings = {
  /**
   * Hours one entry may run before the guard acts. `0` switches it off; the
   * UI's toggle writes 0 rather than carrying a second boolean.
   */
  maxHours: number;
  behavior: RunawayBehavior;
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

/**
 * Money and calendar config, shared by everyone in a workspace.
 *
 * `currency` in particular CANNOT be per-user: every entry snapshots it
 * (TimeEntry.currency) and a report carries exactly one currency for the whole
 * result, so two members with different personal currencies would make that
 * single field a lie.
 */
export type WorkspaceSettings = {
  workspaceId: string;
  defaultHourlyRate: number;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  weekStartsOn: WeekStart;
};

/**
 * Display preferences that belong to a person, not to a workspace.
 *
 * Idle detection lives here rather than on the workspace: how long a machine
 * sits before its owner counts as away, and what should happen then, is a fact
 * about that person's desk, not a policy their colleagues share. The runaway
 * guard sits beside it for a related reason — see {@link MaxDurationSettings}.
 */
export type UserPreferences = {
  userId: string;
  timeFormat: TimeFormat;
  durationFormat: DurationFormat;
  pomodoro: PomodoroSettings;
  idle: IdleSettings;
  maxDuration: MaxDurationSettings;
};

/**
 * What `settings.get` returns: the two records above, merged.
 *
 * The storage split is the part that is expensive to change later, so it
 * happens now; the wire shape stays merged so no client has to change yet.
 * Splitting the procedure is a later, reversible step.
 */
export type ResolvedSettings = WorkspaceSettings & Omit<UserPreferences, "userId"> & {
  userId: string;
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
