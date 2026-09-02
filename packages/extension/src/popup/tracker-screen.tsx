import { useEffect, useState, type FormEvent, type JSX } from "react";
import {
  createId,
  deviceTimeZone,
  formatDuration,
  type Client,
  type IdleAnswer,
  type Project,
  type QuickStart,
  type SyncStatus,
  type TimeEntry,
} from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import { ApiUrlEditor } from "./api-url-editor";
import { Combobox, type ComboboxOption } from "./combobox";
import { IdlePanel } from "./idle-panel";
import { Menu } from "./menu";
import { QuickStartList } from "./quick-start-list";
import { useElapsedSec } from "./use-elapsed";

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
  ) => Promise<boolean>;
  onStop: () => Promise<boolean>;
  onPinFavorite: (quick: QuickStart) => Promise<boolean>;
  onUnpinFavorite: (id: string) => Promise<boolean>;
  /** Resolves the idle span the worker parked while the popup was closed. */
  onAnswerIdle: (answer: IdleAnswer) => Promise<boolean>;
  onSignOut: () => Promise<boolean>;
  onSaveApiUrl: (apiUrl: string) => Promise<boolean>;
  /** Loads the task list for a project into the worker's snapshot. */
  onSelectProject: (projectId: string | null) => Promise<boolean>;
  onCreateClient: (name: string) => Promise<boolean>;
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

const SYNC_LABEL: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  open: "Synced",
  closed: "Offline",
};

/**
 * The entry the popup shows the instant Start is pressed, before the worker
 * has answered. Only description, project and start are ever read from it;
 * the server-owned fields are placeholders that the real snapshot overwrites
 * a moment later.
 */
const provisionalEntry = (
  description: string,
  projectId: string | null,
  taskId: string | null,
): TimeEntry => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    ownerId: "",
    description,
    projectId,
    taskId,
    billable: false,
    start: now,
    end: null,
    durationSec: 0,
    hourlyRate: null,
    currency: "",
    source: "extension",
    timeZone: deviceTimeZone(),
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

function ProjectLabel({
  projects,
  projectId,
}: {
  projects: Project[];
  projectId: string | null;
}): JSX.Element | null {
  const project = projects.find((candidate) => candidate.id === projectId);
  // An archived project is not in the list the worker sends; showing nothing
  // beats showing a raw id.
  if (!project) return null;
  return (
    <span className="project" data-testid="tracker-project-label">
      <span className="project__dot" style={{ backgroundColor: project.color }} />
      {project.name}
    </span>
  );
}

export function TrackerScreen({
  state,
  error,
  onStart,
  onStop,
  onPinFavorite,
  onUnpinFavorite,
  onAnswerIdle,
  onSignOut,
  onSaveApiUrl,
  onSelectProject,
  onCreateClient,
  onCreateProject,
  onCreateTask,
}: TrackerScreenProps): JSX.Element {
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
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

  // Tasks belong to a project, so picking one has to go and fetch them. The
  // worker holds the list; this only asks for it.
  useEffect(() => {
    void onSelectProject(projectId);
  }, [projectId, onSelectProject]);

  const selectProject = (next: string | null): void => {
    setProjectId(next);
    // A task from the old project would be silently wrong against the new one.
    setTaskId(null);
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

  const createTask = async (name: string): Promise<void> => {
    if (projectId === null) return;
    await onCreateTask(projectId, name);
  };

  /**
   * Start a favorite or a recent.
   *
   * Same call as the form's own submit — `timer:start` with the four fields
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

  const start = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setOptimistic({
      running: provisionalEntry(description.trim(), projectId, taskId),
    });

    const started = await onStart(description.trim(), projectId, taskId);

    // Either way the override goes: on success the worker's snapshot is the
    // better truth, on failure dropping it reverts the UI to what is real.
    setOptimistic(null);
    setBusy(false);
    if (started) {
      setDescription("");
      setTaskId(null);
    }
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

        {running === null ? (
          <form className="form" onSubmit={start} data-testid="tracker-start-form">
            {/* Above the description field on purpose: the whole point is not
                having to fill it in. */}
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
              onChange={setTaskId}
              emptyLabel="No task"
              placeholder="Search tasks…"
              disabled={projectId === null}
              disabledHint="Pick a project first"
              onCreate={createTask}
              createLabel={(name) => `Create task “${name}”`}
              testId="tracker-task"
            />

            <button
              className="button button--primary button--block"
              type="submit"
              disabled={busy || pendingProject !== null}
              data-testid="tracker-start"
            >
              Start
            </button>
          </form>
        ) : (
          <div className="running" data-testid="tracker-running">
            <span
              className={
                running.description.trim() === ""
                  ? "running__description running__description--empty"
                  : "running__description"
              }
            >
              {running.description.trim() === ""
                ? "No description"
                : running.description}
            </span>
            <ProjectLabel projects={state.projects} projectId={running.projectId} />
            <span className="elapsed" data-testid="tracker-elapsed">
              {formatElapsed(elapsedSec)}
            </span>
            <button
              className="button button--danger button--block"
              type="button"
              onClick={() => {
                void stop();
              }}
              disabled={busy}
              data-testid="tracker-stop"
            >
              Stop
            </button>
          </div>
        )}

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
          <span className="status" data-testid="tracker-sync-status">
            <span className={`status__dot status__dot--${state.syncStatus}`} />
            {SYNC_LABEL[state.syncStatus]}
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
