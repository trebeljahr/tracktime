import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Toast,
  open,
  showToast,
} from "@raycast/api";
import {
  pollForDeviceSession,
  startDeviceAuthorization,
  type DeviceAuthorization,
} from "@starter/core";
import { useEffect, useRef, useState } from "react";
import {
  CLIENT_ID,
  getStoredSession,
  signOut,
  storeSession,
} from "./lib/auth.js";
import { apiUrl, webLink } from "./lib/preferences.js";
import { refreshMenuBar } from "./lib/ui.js";

/**
 * RFC 8628 device flow.
 *
 * Raycast never sees the password: it asks the server for a short code, the
 * user approves that code in a browser that is already signed in, and Raycast
 * ends up with a normal better-auth session token it can revoke from
 * Settings → Devices like any other device.
 */
type Phase =
  | { kind: "checking" }
  | { kind: "signedIn"; email: string | null }
  | { kind: "pairing"; authorization: DeviceAuthorization }
  | { kind: "failed"; message: string };

export default function SignIn(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    let cancelled = false;

    const run = async (): Promise<void> => {
      const existing = await getStoredSession();
      if (cancelled) return;
      if (existing && attempt === 0) {
        setPhase({ kind: "signedIn", email: existing.email });
        return;
      }

      const options = { baseUrl: apiUrl(), clientId: CLIENT_ID } as const;

      try {
        const authorization = await startDeviceAuthorization(options);
        if (cancelled) return;
        setPhase({ kind: "pairing", authorization });

        // Opening the prefilled page is the whole point of the flow — the
        // user should not have to retype a code they can just confirm.
        if (authorization.verificationUriComplete) {
          await open(authorization.verificationUriComplete);
        }

        const session = await pollForDeviceSession(
          options,
          authorization.deviceCode,
          {
            intervalSeconds: authorization.intervalSeconds,
            timeoutSeconds: authorization.expiresInSeconds,
            signal: abort.signal,
          },
        );
        if (cancelled) return;

        await storeSession(session);
        await refreshMenuBar();
        setPhase({ kind: "signedIn", email: session.email });
        await showToast({
          style: Toast.Style.Success,
          title: "Raycast paired with tracktime",
          message: session.email ?? undefined,
        });
      } catch (error) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [attempt]);

  const retry = (): void => {
    abortRef.current?.abort();
    setPhase({ kind: "checking" });
    setAttempt((value) => value + 1);
  };

  if (phase.kind === "checking") {
    return <Detail isLoading markdown="# Connecting to tracktime…" />;
  }

  if (phase.kind === "signedIn") {
    return (
      <Detail
        markdown={[
          "# Signed in",
          "",
          phase.email
            ? `Raycast is paired with **${phase.email}**.`
            : "Raycast is paired with your tracktime account.",
          "",
          "It shows up as **Raycast** under Settings → Devices in the web app,",
          "where you can sign it out at any time.",
        ].join("\n")}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser
              title="Open Web App"
              url={webLink("/track")}
            />
            <Action
              title="Sign out"
              icon={Icon.Logout}
              style={Action.Style.Destructive}
              onAction={async () => {
                await signOut();
                await refreshMenuBar();
                await showToast({
                  style: Toast.Style.Success,
                  title: "Signed out",
                });
                setPhase({ kind: "failed", message: "Signed out." });
              }}
            />
            <Action title="Pair Again" icon={Icon.Repeat} onAction={retry} />
          </ActionPanel>
        }
      />
    );
  }

  if (phase.kind === "pairing") {
    const { userCode, verificationUri, verificationUriComplete } =
      phase.authorization;
    return (
      <Detail
        isLoading
        markdown={[
          "# Approve this Mac",
          "",
          `## \`${userCode}\``,
          "",
          `Confirm it at ${verificationUri || webLink("/device")} — that page`,
          "should already be open in your browser.",
          "",
          "Waiting for approval…",
        ].join("\n")}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser
              title="Open Approval Page"
              url={verificationUriComplete || verificationUri || webLink("/device")}
            />
            <Action.CopyToClipboard title="Copy Code" content={userCode} />
            <Action title="Start over" icon={Icon.Repeat} onAction={retry} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <Detail
      markdown={[
        "# Could not pair",
        "",
        phase.message,
        "",
        `Check the **API URL** extension preference — currently \`${apiUrl()}\`.`,
      ].join("\n")}
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.Repeat} onAction={retry} />
          <Action.OpenInBrowser title="Open Web App" url={webLink("/track")} />
        </ActionPanel>
      }
    />
  );
}
