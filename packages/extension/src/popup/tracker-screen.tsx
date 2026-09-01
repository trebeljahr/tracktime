import { useState, type FormEvent, type JSX } from "react";
import {
  createId,
  deviceTimeZone,
  formatDuration,
  type Project,
  type SyncStatus,
  type TimeEntry,
} from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import { ApiUrlEditor } from "./api-url-editor";
import { useElapsedSec } from "./use-elapsed";

export type TrackerScreenProps = {
  state: BackgroundState;
  /** The last failure, already translated into human terms. */
  error: string | null;
  onStart: (description: string, projectId: string | null) => Promise<boolean>;
  onStop: () => Promise<boolean>;
  onSignOut: () => Promise<boolean>;
  onSaveApiUrl: (apiUrl: string) => Promise<boolean>;
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
): TimeEntry => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    ownerId: "",
    description,
    projectId,
    taskId: null,
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
  onSignOut,
  onSaveApiUrl,
}: TrackerScreenProps): JSX.Element {
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showApiUrl, setShowApiUrl] = useState(false);

  // While a start/stop is in flight this holds the timer the user just asked
  // for. `null` (the outer one) means "no override" — the inner `running` is
  // itself nullable, which is exactly the stopped case, so the two cannot be
  // collapsed into one nullable field.
  const [optimistic, setOptimistic] = useState<{ running: TimeEntry | null } | null>(
    null,
  );

  const running = optimistic === null ? state.running : optimistic.running;
  const elapsedSec = useElapsedSec(running);

  const start = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setOptimistic({ running: provisionalEntry(description.trim(), projectId) });

    const started = await onStart(description.trim(), projectId);

    // Either way the override goes: on success the worker's snapshot is the
    // better truth, on failure dropping it reverts the UI to what is real.
    setOptimistic(null);
    setBusy(false);
    if (started) setDescription("");
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

  return (
    <div className="tracker" data-testid="tracker-screen">
      <div className="popup__body">
        {running === null ? (
          <form className="form" onSubmit={start} data-testid="tracker-start-form">
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

            <div className="field">
              <label className="field__label" htmlFor="project">
                Project
              </label>
              <select
                id="project"
                className="select"
                value={projectId ?? ""}
                onChange={(event) =>
                  setProjectId(event.target.value === "" ? null : event.target.value)
                }
                data-testid="tracker-project"
              >
                <option value="">No project</option>
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="button button--primary button--block"
              type="submit"
              disabled={busy}
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
        </div>

        <div className="footer__row">
          <button
            className="button button--link"
            type="button"
            aria-expanded={showApiUrl}
            aria-controls="api-url-panel"
            onClick={() => setShowApiUrl((open) => !open)}
            data-testid="tracker-api-url-toggle"
          >
            {showApiUrl ? "Hide API URL" : "API URL"}
          </button>
          <button
            className="button button--link"
            type="button"
            onClick={() => {
              void signOut();
            }}
            disabled={busy}
            data-testid="tracker-sign-out"
          >
            Sign out
          </button>
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
