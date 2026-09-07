/**
 * Shared bits of the catalog commands: how a delete is reported, and how the
 * numeric project fields survive a round trip through a text field.
 */
import type { CatalogRemoveResult, TagRemoveResult } from "@starter/core";

/** `""` is the dropdown's stand-in for "no client"/"no project"/"no task". */
export const NONE = "";

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What a catalog delete actually cost, in one line.
 *
 * Deleting never deletes tracked time, so silence here would read as "nothing
 * happened" when in fact a month of entries just lost their project. The
 * counts are stated, and a clean delete says so.
 */
export const describeRemoval = (result: CatalogRemoveResult): string => {
  const parts: string[] = [];
  if (result.tasksDeleted > 0) {
    parts.push(`${plural(result.tasksDeleted, "task")} deleted`);
  }
  if (result.projectsDetached > 0) {
    parts.push(`${plural(result.projectsDetached, "project")} kept, unfiled`);
  }
  if (result.entriesDetached > 0) {
    parts.push(`${plural(result.entriesDetached, "entry")} kept, unfiled`);
  }
  if (result.favoritesDetached > 0) {
    parts.push(`${plural(result.favoritesDetached, "favorite")} unfiled`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing else referenced it";
};

/** A tag removal is either a delete or an archive; say which. */
export const describeTagRemoval = (result: TagRemoveResult): string =>
  result.deleted
    ? "Tag deleted"
    : (result.message ?? "Tag archived — it is still on tracked time");

/**
 * Read an optional number out of a form field.
 *
 * Three outcomes, all meaningful: empty clears the value (`null`), a number
 * sets it, and anything else is a mistake the caller must refuse rather than
 * silently turn into a cleared field.
 */
export const parseOptionalNumber = (
  raw: string,
): { ok: true; value: number | null } | { ok: false } => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  // Commas are what a German keyboard produces for a decimal point, and the
  // number this becomes is money — worth accepting rather than rejecting.
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) return { ok: false };
  return { ok: true, value };
};

/** Trimmed, or undefined when the field was left empty. */
export const optionalText = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
};
