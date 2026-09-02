import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { QuickStart } from "@starter/core";
import {
  sendToBackground,
  type BackgroundResponse,
  type BackgroundState,
  type PopupToBackground,
} from "../lib/messaging";
import { DEFAULT_API_URL } from "../lib/config";
import { describeError } from "./errors";
import { SignInScreen } from "./sign-in-screen";
import { TrackerScreen } from "./tracker-screen";

/**
 * The whole popup.
 *
 * It owns no domain state of its own: every message returns a full
 * {@link BackgroundState}, which is stored verbatim and rendered. The only
 * local state is "have we heard from the worker yet" and "what went wrong
 * last time" — everything else lives in the service worker, which survives
 * the popup being destroyed on every close.
 */

/** How often an open popup re-reads the worker's snapshot. */
const REFRESH_MS = 3000;

export function App(): JSX.Element {
  const [state, setState] = useState<BackgroundState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Could not reach X" has to name the URL that actually failed, but reading
  // it from state would make `send` change identity on every snapshot — and a
  // `send` that changes identity re-runs the mount effect below. A ref keeps
  // the message current and the callback stable.
  const apiUrlRef = useRef(DEFAULT_API_URL);

  /**
   * One funnel for every message, so a fresh snapshot is applied and a
   * failure is translated in exactly one place. Resolves true on success,
   * which is all the callers need to decide whether to clear their inputs.
   */
  const send = useCallback(
    async (message: PopupToBackground): Promise<boolean> => {
      const response: BackgroundResponse = await sendToBackground(message);
      if (response.ok) {
        apiUrlRef.current = response.state.apiUrl;
        setState(response.state);
        setError(null);
        return true;
      }
      setError(describeError(response.code, response.message, apiUrlRef.current));
      return false;
    },
    [],
  );

  useEffect(() => {
    void send({ type: "state:get" });
  }, [send]);

  /**
   * Re-poll while the popup is open.
   *
   * The contract is request/response only, so nothing lets the worker push. A
   * popup left open would otherwise render its mount-time snapshot forever:
   * "Connecting…" that never becomes "Synced" (the socket opens milliseconds
   * after `buildState` reads its status), "Offline" after the network is back,
   * or a timer someone started on another device staying invisible.
   *
   * Deliberately silent — it must not clear or set the error banner, or a
   * blip would wipe the message from the action the user just took.
   */
  useEffect(() => {
    const handle = setInterval(() => {
      void sendToBackground({ type: "state:get" }).then((response) => {
        if (!response.ok) return;
        apiUrlRef.current = response.state.apiUrl;
        setState(response.state);
      });
    }, REFRESH_MS);
    return () => clearInterval(handle);
  }, []);

  const signIn = useCallback(
    (email: string, password: string): Promise<boolean> =>
      send({ type: "auth:sign-in", email, password }),
    [send],
  );

  const saveApiUrl = useCallback(
    (apiUrl: string): Promise<boolean> =>
      send({ type: "config:set-api-url", apiUrl }),
    [send],
  );

  const selectProject = useCallback(
    (projectId: string | null): Promise<boolean> =>
      send({ type: "tasks:for-project", projectId }),
    [send],
  );

  const createClient = useCallback(
    (name: string): Promise<boolean> => send({ type: "client:create", name }),
    [send],
  );

  const createProject = useCallback(
    (name: string, clientId: string | null): Promise<boolean> =>
      send({ type: "project:create", name, clientId }),
    [send],
  );

  const createTask = useCallback(
    (projectId: string, name: string): Promise<boolean> =>
      send({ type: "task:create", projectId, name }),
    [send],
  );

  const pinFavorite = useCallback(
    (quick: QuickStart): Promise<boolean> =>
      send({ type: "favorite:add", quick }),
    [send],
  );

  const unpinFavorite = useCallback(
    (id: string): Promise<boolean> => send({ type: "favorite:remove", id }),
    [send],
  );

  if (state === null) {
    return (
      <div className="popup">
        <div className="popup__body">
          {error === null ? (
            <p className="loading" data-testid="popup-loading">
              Loading…
            </p>
          ) : (
            <>
              <p className="notice" role="alert" aria-live="assertive">
                {error}
              </p>
              <button
                className="button button--block"
                type="button"
                onClick={() => {
                  void send({ type: "state:get" });
                }}
                data-testid="popup-retry"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      {state.signedIn ? (
        <TrackerScreen
          state={state}
          error={error}
          onStart={(description, projectId, taskId, billable) =>
            send({
              type: "timer:start",
              description,
              projectId,
              taskId,
              billable,
            })
          }
          onStop={() => send({ type: "timer:stop" })}
          onPinFavorite={pinFavorite}
          onUnpinFavorite={unpinFavorite}
          onAnswerIdle={(answer) => send({ type: "idle:answer", answer })}
          onSignOut={() => send({ type: "auth:sign-out" })}
          onSaveApiUrl={saveApiUrl}
          onSelectProject={selectProject}
          onCreateClient={createClient}
          onCreateProject={createProject}
          onCreateTask={createTask}
        />
      ) : (
        <SignInScreen
          apiUrl={state.apiUrl}
          error={error}
          onSignIn={signIn}
          onSaveApiUrl={saveApiUrl}
        />
      )}
    </div>
  );
}
