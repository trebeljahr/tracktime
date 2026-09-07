import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  createId,
  deviceTimeZone,
  formatDuration,
  withProject,
  withTask,
  type Client,
  type EntryFields,
  type IdleAnswer,
  type Project,
  type QuickStart,
  type SyncStatus,
  type TimeEntry,
} from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import { ApiUrlEditor } from "./api-url-editor";
import { Combobox, type ComboboxOption } from "./combobox";
import { TagPicker } from "./tag-picker";
import { IdlePanel } from "./idle-panel";
import { Menu } from "./menu";
import { QuickStartList } from "./quick-start-list";
import { useElapsedSec } from "./use-elapsed";

/** An edit to the running entry. Absent fields are left alone. */
export type RunningPatch = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  tagIds?: string[];
};

export type TrackerScreenProps = {
  state: BackgroundState;
  /** The last failure, already translated into human terms. */
  error: string | null;
  onStart: (
    description: string,
    projectId: string | null,
    taskId: string | null,
    /** Explicit for a quick start; omitted lets the project default decide. */
    billable?: boolean,
    tagIds?: string[],
  ) => Promise<boolean>;
  onStop: () => Promise<boolean>;
  /** Edits the entry that is running. The worker resolves which one that is. */
  onUpdateRunning: (patch: RunningPatch) => Promise<boolean>;
  onPinFavorite: (quick: QuickStart) => Promise<boolean>;
  onUnpinFavorite: (id: string) => Promise<boolean>;
  /** Resolves the idle span the worker parked while the popup was closed. */
  onAnswerIdle: (answer: IdleAnswer) => Promise<boolean>;
  onSignOut: () => Promise<boolean>;
  onSaveApiUrl: (apiUrl: string) => Promise<boolean>;
  /** Loads the task list for a project into the worker's snapshot. */
  onSelectProject: (projectId: string | null) => Promise<boolean>;
  onCreateClient: (name: string) => Promise<boolean>;
  onCreateTag: (name: string) => Promise<boolean>;
  onCreateProject: (name: string, clientId: string | null) => Promise<boolean>;
  onCreateTask: (projectId: string, name: string) => Promise<boolean>;
};

/**
 * The shared formatter always emits H:MM:SS. At 360px the leading "0:" is
 * noise for the first hour, which is where most entries live, so it is
 * trimmed — the formatting itself still comes from @starter/shared.
 */
const formatElapsed = (seconds: number): string => {
  const hms = formatDuration(seconds, "hms");
  return hms.startsWith("0:") ? hms.slice(2) : hms;
};

/** Local-clock seconds elapsed today, the ceiling on a running entry's share. */
const secondsSinceMidnight = (nowMs: number = Date.now()): number => {
  const now = new Date(nowMs);
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
};

/**
 * What the footer says about sync.
 *
 * "Offline" is reserved for the one case where it is true: the server did not
 * answer. A socket that is down while HTTP is fine is a real but much smaller
 * problem — other devices' changes arrive on the next poll instead of
 * instantly — and labelling it "Offline" while the toolbar was signed in and
 * saving happily was simply wrong, and unnerving with it.
 *
 * Queued work outranks both, because it is the only state where something the
 * user did has not reached the server yet.
 */
const describeSync = (
  status: SyncStatus,
  serverReachable: boolean,
  pending: number,
): { label: string; tone: string; title: string } => {
  if (!serverReachable) {
    return {
      label: pending > 0 ? `Offline · ${pending} queued` : "Offline",
      tone: "closed",
      title:
        pending > 0
          ? `The server is not answering. ${pending} change${pending === 1 ? "" : "s"} will be sent when it does.`
          : "The server is not answering. Timers still start and stop, and are sent when it comes back.",
    };
  }
  if (pending > 0) {
    return {
      label: `${pending} queued`,
      tone: "pending",
      title: `${pending} change${pending === 1 ? "" : "s"} still to send.`,
    };
  }
  if (status === "open") {
    return {
      label: "Synced",
      tone: "open",
      title: "Live updates from your other devices are connected.",
    };
  }
  if (status === "connecting") {
    return {
      label: "Connecting…",
      tone: "connecting",
      title: "Connecting to live updates.",
    };
  }
  return {
    label: "Polling",
    tone: "polling",
    title:
      "Live updates are unavailable, so changes made elsewhere show up on a short delay. Everything you do here is saved normally.",
  };
};

/**
 * The entry the popup shows the instant Start is pressed, before the worker
 * has answered. Only the fields the composer renders are ever read from it;
 * the server-owned ones are placeholders that the real snapshot overwrites a
 * moment later.
 */
const provisionalEntry = (
  description: string,
  projectId: string | null,
  taskId: string | null,
  billable: boolean,
  tagIds: string[],
): TimeEntry => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    workspaceId: "",
    authorId: "",
    description,
    projectId,
    taskId,
    billable,
    start: now,
    end: null,
    durationSec: 0,
    hourlyRate: null,
    currency: "",
    source: "extension",
    timeZone: deviceTimeZone(),
    runaway: null,
    tagIds,
    invoiceId: null,
    importId: null,
    createdAt: now,
    updatedAt: now,
  };
};

const clientName = (
  clients: Client[],
  clientId: string | null,
): string | undefined =>
  clients.find((candidate) => candidate.id === clientId)?.name;

const projectOptions = (
  projects: Project[],
  clients: Client[],
): ComboboxOption[] =>
  projects.map((project) => ({
    id: project.id,
    label: project.name,
    color: project.color,
    hint: clientName(clients, project.clientId),
  }));

/**
 * The rule the server applies to an omitted `billable`, reproduced here.
 *
 * The composer now has a toggle, so it always sends a concrete value — and
 * that value has to start where the server would have put it, or picking a
 * billable project would quietly track unbillable time.
 */
const billableDefaultFor = (
  projects: Project[],
  projectId: string | null,
): boolean => {
  if (projectId === null) return false;
  return (
    projects.find((candidate) => candidate.id === projectId)
      ?.billableDefault ?? false
  );
};

export function TrackerScreen({
  state,
  error,
  onStart,
  onStop,
  onUpdateRunning,
  onPinFavorite,
  onUnpinFavorite,
  onAnswerIdle,
  onSignOut,
  onSaveApiUrl,
  onSelectProject,
  onCreateClient,
  onCreateTag,
  onCreateProject,
  onCreateTask,
}: TrackerScreenProps): JSX.Element {
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showApiUrl, setShowApiUrl] = useState(false);

  /** Set while a new project is being named, holding the client to file it under. */
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);

  // While a start/stop is in flight this holds the timer the user just asked
  // for. `null` (the outer one) means "no override" — the inner `running` is
  // itself nullable, which is exactly the stopped case, so the two cannot be
  // collapsed into one nullable field.
  const [optimistic, setOptimistic] = useState<{ running: TimeEntry | null } | null>(
    null,
  );

  const running = optimistic === null ? state.running : optimistic.running;
  const elapsedSec = useElapsedSec(running);

  /**
   * One set of fields, showing either a draft or the entry that is running.
   *
   * They are re-seeded whenever the timer's *identity* changes — which covers a
   * start or a stop made on another device, not just in this popup — and never
   * on a plain refresh, so an edit being typed here is not overwritten three
   * seconds later by the poll. Done during render rather than in an effect so
   * the fields are right on the first paint after a cross-device change.
   */
  const runningId = running?.id ?? null;
  const [lastRunningId, setLastRunningId] = useState<string | null>(null);
  if (lastRunningId !== runningId) {
    setLastRunningId(runningId);
    if (running !== null) {
      setDescription(running.description);
      setProjectId(running.projectId);
      setTaskId(running.taskId);
      setBillable(running.billable);
      setTagIds(running.tagIds);
    } else {
      // The description and the task belonged to the entry that just ended.
      // The project, its tags and its billable flag stay: the next block of
      // work is usually the same kind of work, and re-picking every label
      // would undo the point of a one-click toolbar.
      setDescription("");
      setTaskId(null);
    }
  }

  // Tasks belong to a project, so whichever project is on screen — the running
  // entry's or the draft's — has to have its task list fetched. The worker
  // holds the list; this only asks for it.
  useEffect(() => {
    void onSelectProject(projectId);
  }, [projectId, onSelectProject]);

  /**
   * Push an edit at the running entry, or do nothing when composing a draft.
   *
   * Deliberately not gated on `busy` and not awaited: labelling work as you go
   * is the whole point of editing a running timer, and a picker that refused
   * the second change until the first round trip finished would feel broken.
   */
  const patchRunning = (patch: RunningPatch): void => {
    if (running === null) return;
    void onUpdateRunning(patch);
  };

  /**
   * The five fields as `@starter/core` sees them, so the popup answers the
   * project/task coupling with the same rules the web app does rather than a
   * second implementation of them that can drift.
   */
  const fields: EntryFields = {
    description,
    projectId,
    taskId,
    billable,
    tagIds,
  };

  const selectProject = (next: string | null): void => {
    const updated = withProject(fields, next);
    if (updated === fields) return;
    setProjectId(updated.projectId);
    // A task from the old project would be silently wrong against the new one,
    // so `withProject` clears it and the patch carries both.
    setTaskId(updated.taskId);

    if (running !== null) {
      patchRunning({ projectId: updated.projectId, taskId: updated.taskId });
      return;
    }
    // Only a draft follows the project's default. Changing the project under a
    // running entry must not silently re-decide whether that time is billable.
    setBillable(billableDefaultFor(state.projects, updated.projectId));
  };

  const selectTask = (next: string | null): void => {
    const updated = withTask(fields, next);
    setTaskId(updated.taskId);
    if (updated.projectId !== projectId) setProjectId(updated.projectId);
    patchRunning({ taskId: updated.taskId, projectId: updated.projectId });
  };

  const selectTags = (next: string[]): void => {
    setTagIds(next);
    patchRunning({ tagIds: next });
  };

  const toggleBillable = (): void => {
    const next = !billable;
    setBillable(next);
    patchRunning({ billable: next });
  };

  /** Save a typed description against the running entry, if it changed. */
  const commitDescription = (): void => {
    if (running === null) return;
    const next = description.trim();
    if (next === running.description) return;
    patchRunning({ description: next });
  };

  const beginProject = async (name: string): Promise<void> => {
    // Two fields, so it cannot be done from inside the picker: naming it is
    // step one, filing it under a client is step two.
    setPendingProject(name);
    setPendingClientId(null);
  };

  const confirmProject = async (): Promise<void> => {
    if (pendingProject === null) return;
    setBusy(true);
    const created = await onCreateProject(pendingProject, pendingClientId);
    setBusy(false);
    if (!created) return;
    setPendingProject(null);
    setPendingClientId(null);
  };

  const createTag = async (name: string): Promise<void> => {
    await onCreateTag(name);
  };

  const createTask = async (name: string): Promise<void> => {
    if (projectId === null) return;
    await onCreateTask(projectId, name);
  };

  /**
   * Start a favorite or a recent.
   *
   * Same call as the composer's own submit — `timer:start` with the fields
   * already chosen — so the worker's billable defaulting, offline queueing and
   * optimistic badge all apply unchanged. The only difference is that
   * `billable` is explicit, because a pin already decided it.
   */
  const startQuick = async (quick: QuickStart): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOptimistic({
      running: provisionalEntry(
        quick.description,
        quick.projectId,
        quick.taskId,
        quick.billable,
        // Quick starts open untagged on purpose: tags ride alongside a
        // QuickStart rather than inside it, so one recurring combination does
        // not fragment into a recent per set of labels.
        [],
      ),
    });
    await onStart(
      quick.description,
      quick.projectId,
      quick.taskId,
      quick.billable,
    );
    setOptimistic(null);
    setBusy(false);
  };

  const pin = async (quick: QuickStart): Promise<void> => {
    setBusy(true);
    await onPinFavorite(quick);
    setBusy(false);
  };

  const unpin = async (id: string): Promise<void> => {
    setBusy(true);
    await onUnpinFavorite(id);
    setBusy(false);
  };

  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOptimistic({
      running: provisionalEntry(
        description.trim(),
        projectId,
        taskId,
        billable,
        tagIds,
      ),
    });

    // Explicit rather than omitted: the composer has a billable toggle now, so
    // the flag on screen is what the entry has to open with — letting the
    // server re-derive it from the project would ignore the toggle.
    await onStart(description.trim(), projectId, taskId, billable, tagIds);

    // Either way the override goes: on success the worker's snapshot is the
    // better truth, on failure dropping it reverts the UI to what is real. The
    // fields are not cleared here — they now show the running entry, and the
    // re-seed above keeps them in step with it.
    setOptimistic(null);
    setBusy(false);
  };

  const answerIdle = async (answer: IdleAnswer): Promise<void> => {
    if (busy) return;
    setBusy(true);
    // No optimistic override: which entry ends up running depends on the
    // answer, and guessing wrong would flash the opposite of what happened.
    await onAnswerIdle(answer);
    setBusy(false);
  };

  const stop = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOptimistic({ running: null });
    await onStop();
    setOptimistic(null);
    setBusy(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (running === null) void start();
    else void stop();
  };

  const signOut = async (): Promise<void> => {
    setBusy(true);
    await onSignOut();
    setBusy(false);
  };

  // `state.todaySec` counts finished entries only, so the running one is added
  // here — clamped to the part of it that falls inside today, or an overnight
  // timer would credit the whole night to this morning.
  const runningToday =
    running === null ? 0 : Math.min(elapsedSec, secondsSinceMidnight());
  const todaySec = state.todaySec + runningToday;

  // The worker's task list can lag a project change by one round trip; showing
  // the previous project's tasks would be actively wrong, so show none.
  const tasks = state.tasksProjectId === projectId ? state.tasks : [];

  const sync = describeSync(
    state.syncStatus,
    state.serverReachable,
    state.pendingSync,
  );

  return (
    <div className="tracker" data-testid="tracker-screen">
      <div className="popup__body">
        {/* Above everything else: it is a question about the time already on
            the clock below, and answering it changes what that clock says. */}
        {state.pendingIdle !== null ? (
          <IdlePanel
            pending={state.pendingIdle}
            busy={busy}
            onAnswer={(answer) => {
              void answerIdle(answer);
            }}
          />
        ) : null}

        {/* Hidden while a timer runs, where the row would only offer to stop
            this one and start another. */}
        {running === null ? (
          <QuickStartList
            items={state.quickStarts}
            disabled={busy}
            onStart={(quick) => {
              void startQuick(quick);
            }}
            onPin={(quick) => {
              void pin(quick);
            }}
            onUnpin={(id) => {
              void unpin(id);
            }}
          />
        ) : null}

        {/* One form for both states. The fields are the same either way — a
            draft's and a running entry's — so splitting them into two blocks
            would mean two places for every field to drift out of step. */}
        <form
          className="form"
          onSubmit={submit}
          data-testid={running === null ? "tracker-start-form" : "tracker-running"}
        >
          {running !== null ? (
            <span className="elapsed" data-testid="tracker-elapsed">
              {formatElapsed(elapsedSec)}
            </span>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="description">
              Description
            </label>
            <input
              id="description"
              className="input"
              type="text"
              autoFocus
              autoComplete="off"
              placeholder="What are you working on?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              // A running entry's description is saved when the field is left,
              // the same as the web app — typing must not fire a mutation per
              // keystroke.
              onBlur={commitDescription}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDescription(running?.description ?? "");
                  event.currentTarget.blur();
                }
              }}
              data-testid="tracker-description"
            />
          </div>

          {pendingProject === null ? (
            <Combobox
              label="Project"
              options={projectOptions(state.projects, state.clients)}
              value={projectId}
              onChange={selectProject}
              emptyLabel="No project"
              placeholder="Search projects…"
              onCreate={beginProject}
              createLabel={(name) => `Create project “${name}”`}
              testId="tracker-project"
            />
          ) : (
            <div className="panel" data-testid="tracker-new-project">
              <p className="panel__title">New project “{pendingProject}”</p>

              <Combobox
                label="Client"
                options={state.clients.map((client) => ({
                  id: client.id,
                  label: client.name,
                  color: client.color,
                }))}
                value={pendingClientId}
                onChange={setPendingClientId}
                emptyLabel="No client"
                placeholder="Search clients…"
                onCreate={async (name) => {
                  await onCreateClient(name);
                }}
                createLabel={(name) => `Create client “${name}”`}
                testId="tracker-new-project-client"
              />

              <div className="panel__actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setPendingProject(null);
                    setPendingClientId(null);
                  }}
                  disabled={busy}
                  data-testid="tracker-new-project-cancel"
                >
                  Cancel
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    void confirmProject();
                  }}
                  disabled={busy}
                  data-testid="tracker-new-project-create"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          <Combobox
            label="Task"
            options={tasks.map((task) => ({ id: task.id, label: task.name }))}
            value={taskId}
            onChange={selectTask}
            emptyLabel="No task"
            placeholder="Search tasks…"
            disabled={projectId === null}
            disabledHint="Pick a project first"
            onCreate={createTask}
            createLabel={(name) => `Create task “${name}”`}
            testId="tracker-task"
          />

          <TagPicker
            tags={state.tags}
            value={tagIds}
            onChange={selectTags}
            onCreate={createTag}
            testId="tracker-tags"
          />

          <button
            className={billable ? "billable billable--on" : "billable"}
            type="button"
            role="switch"
            aria-checked={billable}
            onClick={toggleBillable}
            data-testid="tracker-billable"
            data-billable={billable ? "true" : "false"}
          >
            <span aria-hidden="true" className="billable__mark" />
            {billable ? "Billable" : "Not billable"}
          </button>

          <button
            className={
              running === null
                ? "button button--primary button--block"
                : "button button--danger button--block"
            }
            type="submit"
            disabled={busy || pendingProject !== null}
            data-testid={running === null ? "tracker-start" : "tracker-stop"}
          >
            {running === null ? "Start" : "Stop"}
          </button>
        </form>

        <p className="today">
          <span>Today</span>
          <span className="today__value" data-testid="tracker-today">
            {formatDuration(todaySec, "hms")}
          </span>
        </p>

        <p className="notice" role="alert" aria-live="assertive" data-testid="tracker-error">
          {error ?? ""}
        </p>
      </div>

      <div className="footer">
        <div className="footer__row">
          <span className="footer__email" title={state.email ?? ""}>
            {state.email ?? "Signed in"}
          </span>
          <span className="status" data-testid="tracker-sync-status" title={sync.title}>
            <span className={`status__dot status__dot--${sync.tone}`} />
            {sync.label}
          </span>
          <Menu
            webUrl={state.webUrl}
            sharedSession={state.sessionSource === "web"}
            onEditApiUrl={() => setShowApiUrl((open) => !open)}
            onSignOut={() => {
              void signOut();
            }}
          />
        </div>

        {showApiUrl ? (
          <div id="api-url-panel">
            <ApiUrlEditor apiUrl={state.apiUrl} onSave={onSaveApiUrl} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
