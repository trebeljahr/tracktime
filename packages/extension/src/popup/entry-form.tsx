import { useRef, useState, type JSX } from "react";
import {
  deviceTimeZone,
  formatDuration,
  isSameZone,
  parseDurationInput,
  rollEndAfterStart,
  withDayInZone,
  zoneLabel,
  type Client,
  type DayKey,
  type DurationFormat,
  type Project,
  type TimeFormat,
} from "@starter/core";
import type { BackgroundState } from "../lib/messaging";
import { Combobox, type ComboboxOption } from "./combobox";
import { DayStepper } from "./day-stepper";
import { Switch } from "./switch";
import { TagPicker } from "./tag-picker";
import { TimeField } from "./time-field";
import type { EntryDraft } from "./route";

/**
 * The fields an entry has, in both the modes that can change them.
 *
 * One component for editing an existing entry and for writing a new one,
 * because the two show the same eight fields and splitting them would be two
 * places for every field to drift out of step — the same argument the tracker's
 * single form makes about a draft and a running entry.
 *
 * What differs is only WHEN a change leaves the screen, and that is the
 * caller's decision: every change is reported with the patch it implies, and an
 * edit screen sends that patch immediately while a create screen accumulates
 * them until its one button is pressed.
 *
 * Field order is not arbitrary. Both `Combobox`es sit in the top ~260px, so
 * their dropdowns have room to hang downward on a screen that has not been
 * scrolled.
 */

/**
 * The fields one commit changes. Absent means "not touched".
 *
 * Sending only what was touched is not economy: `entries.update` refuses an
 * invoiced entry on the mere PRESENCE of `projectId`, `taskId`, `billable`,
 * `start` or `end` — changed or not — so a form that always sent its whole
 * shape would be refused on an entry it never modified.
 */
export type EntryFieldPatch = {
  description?: string;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  tagIds?: string[];
  start?: string;
  end?: string;
};

export type EntryFormProps = {
  mode: "edit" | "create";
  state: BackgroundState;
  values: EntryDraft;
  /** The zone the clock fields read and write in — the entry's, not this device's. */
  zone: string;
  /** The entry is on an invoice: times, project, task and billable are locked. */
  locked?: boolean;
  /** The row is still a queued create, so nothing about it can be edited yet. */
  readOnly?: boolean;
  onChange: (next: EntryDraft, patch: EntryFieldPatch) => void;
  /**
   * Loads the task list for a project into the worker's snapshot.
   *
   * Must keep a stable identity across renders — a `useCallback`, as the
   * tracker's equivalent already is. It is an effect dependency, and a fresh
   * arrow per render would fetch the task list on every snapshot, each fetch
   * producing the snapshot that triggers the next.
   */
  onCreateTag: (name: string) => Promise<boolean>;
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

/** The rule the server applies to an omitted `billable`, reproduced here. */
const billableDefaultFor = (
  projects: Project[],
  projectId: string | null,
): boolean => {
  if (projectId === null) return false;
  return (
    projects.find((candidate) => candidate.id === projectId)?.billableDefault ??
    false
  );
};

/** An entry shorter than this is almost certainly a mistyped duration. */
const MIN_SECONDS = 60;

type DurationFieldProps = {
  seconds: number;
  format: DurationFormat;
  onCommit: (seconds: number) => void;
  disabled: boolean;
  testId: string;
};

/**
 * Duration as the third way to say the same thing.
 *
 * It writes the end, never the start: "make this 90 minutes" means the work
 * went on longer, not that it began earlier. Parsed by `parseDurationInput`, so
 * "1:30", "90", "1h30m" and "1.5h" all work exactly as they do on the web.
 */
function DurationField({
  seconds,
  format,
  onCommit,
  disabled,
  testId,
}: DurationFieldProps): JSX.Element {
  const shown = formatDuration(seconds, format);
  const [draft, setDraft] = useState(shown);

  const [lastShown, setLastShown] = useState(shown);
  if (lastShown !== shown) {
    setLastShown(shown);
    setDraft(shown);
  }

  const commit = (): void => {
    const parsed = parseDurationInput(draft);
    if (parsed === null) {
      setDraft(shown);
      return;
    }
    const next = Math.max(MIN_SECONDS, parsed);
    setDraft(formatDuration(next, format));
    if (next !== seconds) onCommit(next);
  };

  return (
    <div className="range__field">
      <label className="field__label" htmlFor={`${testId}-input`}>
        Duration
      </label>
      <input
        id={`${testId}-input`}
        className="input input--time"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(shown);
            event.currentTarget.blur();
          }
        }}
        data-testid={testId}
      />
    </div>
  );
}

export function EntryForm({
  mode,
  state,
  values,
  zone,
  locked = false,
  readOnly = false,
  onChange,
  onCreateTag,
}: EntryFormProps): JSX.Element {
  const timeFormat: TimeFormat = state.settings?.timeFormat ?? "24h";
  const durationFormat: DurationFormat = state.settings?.durationFormat ?? "hms";

  // An invoiced entry still accepts a description and tags — that is exactly
  // what the server permits — so the two locks are not the same lock.
  const labelsLocked = readOnly;
  const factsLocked = readOnly || locked;

  const [text, setText] = useState(values.description);
  const [lastText, setLastText] = useState(values.description);
  if (lastText !== values.description) {
    setLastText(values.description);
    setText(values.description);
  }

  // Tasks are workspace-wide, so the snapshot always carries the whole list.
  const tasks = state.tasks;

  const change = (next: Partial<EntryDraft>, patch: EntryFieldPatch): void => {
    onChange({ ...values, ...next }, patch);
  };

  const typeDescription = (next: string): void => {
    setText(next);
    if (mode !== "create") return;
    // A create's fields are local until the button is pressed, so propagating
    // each keystroke costs nothing — and it is what puts the sentence in route
    // memory, where a stolen focus cannot take it.
    setLastText(next);
    change({ description: next }, {});
  };

  /**
   * Set for the length of an Escape, and read by the blur it causes.
   *
   * `blur()` dispatches React's `onBlur` synchronously inside the key handler,
   * before the `setText` above it has been applied — so without this the
   * commit runs against the abandoned text and Escape SAVES the edit it was
   * pressed to throw away.
   */
  const reverting = useRef(false);

  const commitDescription = (): void => {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const next = text.trim();
    if (next === values.description) return;
    setText(next);
    setLastText(next);
    change({ description: next }, { description: next });
  };

  const selectProject = (next: string | null): void => {
    if (next === values.projectId) return;
    // The task is deliberately left alone: it names what the work was, which a
    // change of project does not revise.
    if (mode === "create") {
      // Only a draft follows the project's default, the same rule the tracker
      // applies: changing the project under an existing entry must not
      // silently re-decide whether that time was billable. And only while the
      // switch still says whatever the previous project decided — once it has
      // been moved by hand it is an answer, not a default waiting to be
      // overwritten by the next project pick.
      const untouched =
        values.billable === billableDefaultFor(state.projects, values.projectId);
      change(
        {
          projectId: next,
          billable: untouched
            ? billableDefaultFor(state.projects, next)
            : values.billable,
        },
        {},
      );
      return;
    }
    change({ projectId: next }, { projectId: next });
  };

  const setDay = (dayKey: DayKey): void => {
    const start = withDayInZone(values.start, dayKey, zone);
    const delta = Date.parse(start) - Date.parse(values.start);
    if (delta === 0) return;
    // The end moves by the same delta, so a day step preserves the length
    // instead of stretching the entry across the days it stepped over.
    const end = new Date(Date.parse(values.end) + delta).toISOString();
    change({ start, end }, { start, end });
  };

  const setStart = (iso: string): void => {
    if (Date.parse(iso) === Date.parse(values.start)) return;
    // Only the start moves, exactly as the web app's two entry dialogs do it.
    // Carrying the end along the way `setDay` does would write a time the work
    // did not stop at: correcting a 09:00–17:00 entry to 10:00 means seven
    // hours, not eight ending at 18:00. A start pushed past its own end is the
    // one case that has to move it, and then only far enough to stay legal.
    const end =
      Date.parse(values.end) > Date.parse(iso)
        ? values.end
        : new Date(Date.parse(iso) + MIN_SECONDS * 1000).toISOString();
    if (end === values.end) {
      change({ start: iso }, { start: iso });
      return;
    }
    change({ start: iso, end }, { start: iso, end });
  };

  const setEnd = (iso: string): void => {
    // Rolled, never clamped: a timer running at 23:30 and ended at 00:30 is an
    // hour of work, and clamping to start + a minute would destroy it.
    const end = rollEndAfterStart(values.start, iso, 1);
    if (end === values.end) return;
    change({ end }, { end });
  };

  const setDurationSec = (seconds: number): void => {
    const end = new Date(
      Date.parse(values.start) + seconds * 1000,
    ).toISOString();
    if (end === values.end) return;
    change({ end }, { end });
  };

  const seconds = Math.max(
    0,
    Math.round((Date.parse(values.end) - Date.parse(values.start)) / 1000),
  );

  return (
    <div className="form" data-testid="entry-form">
      <div className="field">
        <label className="field__label" htmlFor="entry-description">
          Description
        </label>
        <input
          id="entry-description"
          className="input"
          type="text"
          autoComplete="off"
          placeholder="What was this?"
          value={text}
          disabled={labelsLocked}
          onChange={(event) => typeDescription(event.target.value)}
          // Saved when the field is left, the same as the tracker's running
          // description — typing must not fire a mutation per keystroke.
          onBlur={commitDescription}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDescription();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              reverting.current = true;
              setText(values.description);
              event.currentTarget.blur();
            }
          }}
          data-testid="entry-description"
        />
      </div>

      <Combobox
        label="Project"
        options={projectOptions(state.projects, state.clients)}
        value={values.projectId}
        onChange={selectProject}
        emptyLabel="No project"
        placeholder="Search projects…"
        disabled={factsLocked}
        disabledHint={locked ? "On an invoice" : "Not sent yet"}
        testId="entry-project"
      />

      <Combobox
        label="Task"
        options={tasks.map((task) => ({ id: task.id, label: task.name }))}
        value={values.taskId}
        onChange={(next) => change({ taskId: next }, { taskId: next })}
        emptyLabel="No task"
        placeholder="Search tasks…"
        disabled={factsLocked}
        disabledHint={locked ? "On an invoice" : "Not sent yet"}
        testId="entry-task"
      />

      <TagPicker
        tags={state.tags}
        value={values.tagIds}
        onChange={(next) => change({ tagIds: next }, { tagIds: next })}
        onCreate={async (name) => {
          await onCreateTag(name);
        }}
        testId="entry-tags"
      />

      <Switch
        checked={values.billable}
        onChange={(next) => change({ billable: next }, { billable: next })}
        label={values.billable ? "Billable" : "Not billable"}
        variant="struck"
        disabled={factsLocked}
        testId="entry-billable"
      />

      <DayStepper
        value={values.start}
        zone={zone}
        onChange={setDay}
        disabled={factsLocked}
        testId="entry-start-day"
      />

      <div className="range">
        <TimeField
          label="Start"
          value={values.start}
          zone={zone}
          timeFormat={timeFormat}
          onCommit={setStart}
          disabled={factsLocked}
          testId="entry-start-time"
        />
        <TimeField
          label="End"
          value={values.end}
          zone={zone}
          timeFormat={timeFormat}
          onCommit={setEnd}
          disabled={factsLocked}
          testId="entry-end-time"
        />
        <DurationField
          seconds={seconds}
          format={durationFormat}
          onCommit={setDurationSec}
          disabled={factsLocked}
          testId="entry-duration"
        />
      </div>

      {/* Said once, below the times it applies to. There is no way to change
          the zone — `updateEntrySchema` has no `timeZone`, deliberately: the
          reading you wrote down is the reading you get back. */}
      {isSameZone(zone, deviceTimeZone()) ? null : (
        <p className="detail__note" data-testid="entry-zone-note">
          Recorded in {zoneLabel(zone)}, and edited in that clock.
        </p>
      )}
    </div>
  );
}
