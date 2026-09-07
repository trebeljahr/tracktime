/**
 * What every client lets you say about a block of time.
 *
 * Five things decide what an entry *is* — its description, its project, its
 * task, its tags and whether it is billable — and all five are settable from
 * every surface that creates or edits one: the tracker bar, the manual dialog,
 * an entry row, the calendar, the browser extension popup, the Raycast forms.
 * They live here rather than in any one of those because the RULES that hold
 * between them are not per-surface, and every place that reimplemented them
 * got at least one wrong.
 *
 * Client is deliberately absent, and is not a sixth field. An entry has no
 * client column: a client owns projects, a project owns tasks, and an entry
 * points at a project. Clients are therefore SHOWN everywhere (grouping the
 * project list, labelling the chosen project) and CHOSEN nowhere — picking one
 * directly would either be a filter wearing a field's clothes, or a second
 * source of truth that can disagree with the project's own client.
 *
 * Framework-free, like the rest of core — no React, no DOM, no tRPC.
 */

/** The five fields that decide what an entry tracks. */
export type EntryFields = {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  tagIds: string[];
};

/** A blank composer: no project, no task, no tags, not billable. */
export const emptyEntryFields = (): EntryFields => ({
  description: "",
  projectId: null,
  taskId: null,
  billable: false,
  tagIds: [],
});

/** The five fields as they stand on an existing entry. */
export const entryFieldsFrom = (entry: {
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  tagIds: string[];
}): EntryFields => ({
  description: entry.description,
  projectId: entry.projectId,
  taskId: entry.taskId,
  billable: entry.billable,
  tagIds: [...entry.tagIds],
});

/**
 * Move an entry to another project, taking its task with it.
 *
 * A task belongs to exactly one project, and the server refuses the pair when
 * they disagree — `entries.update` answers "Task does not belong to the given
 * project". So changing the project must clear the task in the SAME step: a
 * surface that sends the project alone turns an ordinary re-file into a 400
 * the moment the entry happens to carry a task.
 *
 * Re-picking the project that is already set leaves the task alone, so that
 * closing a picker on the current value is never destructive.
 */
export const withProject = (
  fields: EntryFields,
  projectId: string | null,
): EntryFields =>
  projectId === fields.projectId
    ? fields
    : { ...fields, projectId, taskId: null };

/**
 * Pick a task, adopting the project it belongs to.
 *
 * The adoption is what makes "create a task from the picker" work: the task
 * dialog carries a project picker of its own, so the task that comes back may
 * belong somewhere other than where the composer was pointing. Following it is
 * the only reading that keeps the pair valid — the alternative is a task filed
 * under a project it is not part of.
 *
 * `taskProjectId` is optional so callers picking from a list already scoped to
 * the current project need not look it up again.
 */
export const withTask = (
  fields: EntryFields,
  taskId: string | null,
  taskProjectId?: string | null,
): EntryFields => ({
  ...fields,
  taskId,
  projectId:
    taskId !== null && taskProjectId != null
      ? taskProjectId
      : fields.projectId,
});

/** Replace the whole tag set, preserving the order they were picked in. */
export const withTags = (
  fields: EntryFields,
  tagIds: readonly string[],
): EntryFields => ({ ...fields, tagIds: [...tagIds] });

/** Same ids in the same order. Tag sets are arrays, so `===` never answers. */
export const sameTagIds = (
  a: readonly string[],
  b: readonly string[],
): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/** Whether two field sets describe the same tracked thing. */
export const sameEntryFields = (a: EntryFields, b: EntryFields): boolean =>
  a.description === b.description &&
  a.projectId === b.projectId &&
  a.taskId === b.taskId &&
  a.billable === b.billable &&
  sameTagIds(a.tagIds, b.tagIds);
