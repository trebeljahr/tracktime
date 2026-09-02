import type { JSX } from "react";
import { formatIdleSpan, type IdleAnswer, type PendingIdle } from "@starter/core";

export type IdlePanelProps = {
  pending: PendingIdle;
  busy: boolean;
  onAnswer: (answer: IdleAnswer) => void;
};

/**
 * The idle question, asked in the popup.
 *
 * The service worker detected the idleness and then did nothing — it has no UI
 * to ask in, and acting without asking is precisely what the `ask` behaviour
 * exists to avoid. So the timer kept running and the question waited here for
 * the next time the toolbar was opened. Nothing has been discarded yet, which
 * is why the copy says "still running" rather than reporting a change.
 */
export function IdlePanel({
  pending,
  busy,
  onAnswer,
}: IdlePanelProps): JSX.Element {
  const span = formatIdleSpan(pending.idleSec);

  return (
    <div className="panel" data-testid="idle-panel">
      <p className="panel__title">
        {pending.signal === "locked"
          ? `Screen was locked for ${span}`
          : `No input for ${span}`}
      </p>
      <p className="panel__hint">
        The timer is still running. Keep that time if you were reading, in a
        meeting or on a call.
      </p>

      <div className="panel__actions">
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => onAnswer("keep")}
          data-testid="idle-keep"
        >
          I was working
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => onAnswer("discard")}
          data-testid="idle-discard"
        >
          Discard {span}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => onAnswer("discard-and-resume")}
          data-testid="idle-discard-resume"
        >
          Discard and resume
        </button>
      </div>
    </div>
  );
}
