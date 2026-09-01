import { useState, type FormEvent, type JSX } from "react";
import { DEFAULT_API_URL } from "../lib/config";

export type ApiUrlEditorProps = {
  apiUrl: string;
  /** Resolves true when the worker accepted and stored the new URL. */
  onSave: (apiUrl: string) => Promise<boolean>;
};

/**
 * Edit the server this extension talks to.
 *
 * `pnpm run dev` picks a random API port per run, so the URL baked in at build
 * time is stale for most local sessions. This is deliberately reachable from
 * the signed-out screen too: a user who cannot reach the server has to fix the
 * URL *before* a sign-in can possibly succeed.
 */
export function ApiUrlEditor({ apiUrl, onSave }: ApiUrlEditorProps): JSX.Element {
  const [draft, setDraft] = useState(apiUrl);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Re-seed the field when the worker reports a different URL (another popup
  // changed it, or the first snapshot arrived after this mounted). Doing it
  // during render rather than in an effect keeps the input right on the very
  // first paint.
  const [lastApiUrl, setLastApiUrl] = useState(apiUrl);
  if (lastApiUrl !== apiUrl) {
    setLastApiUrl(apiUrl);
    setDraft(apiUrl);
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = draft.trim();

    // Validated here as well as in the worker so a typo answers instantly
    // instead of after a round trip.
    try {
      new URL(trimmed);
    } catch {
      setNote(`Not a valid URL: ${trimmed}`);
      return;
    }

    setBusy(true);
    setNote(null);
    const saved = await onSave(trimmed);
    setBusy(false);
    // A rejection is already rendered by the screen's own error region;
    // only the success needs a word here.
    if (saved) setNote("Saved.");
  };

  return (
    <form className="form" onSubmit={submit} data-testid="api-url-form">
      <div className="field">
        <label className="field__label" htmlFor="api-url">
          API URL
        </label>
        <input
          id="api-url"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          // This build's own target, not a hardcoded localhost: a production
          // popup suggesting a laptop address is worse than no hint at all.
          placeholder={DEFAULT_API_URL}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setNote(null);
          }}
          data-testid="api-url-input"
        />
      </div>
      <button
        className="button"
        type="submit"
        disabled={busy || draft.trim() === ""}
        data-testid="api-url-save"
      >
        {busy ? "Saving…" : "Save API URL"}
      </button>
      <p className="notice notice--ok" role="status" aria-live="polite">
        {note ?? ""}
      </p>
    </form>
  );
}
