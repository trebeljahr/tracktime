// Tag ids on an entry: cleaning them, and proving they exist.
import mongoose from "mongoose";
import { Tag } from "../../models/Tag.js";
import { badRequest } from "./errors.js";

/**
 * Hard cap on tags per entry, kept in lockstep with `entryTagIds` in
 * @starter/shared. The schema already rejects an over-long array, so this is
 * the second line of defence for the paths that build a list themselves
 * (`continue` copies the source entry's tags).
 */
export const MAX_ENTRY_TAGS = 20;

/**
 * Clean a caller-supplied tag list WITHOUT touching the database.
 *
 * Deduplicates (first occurrence wins, so the order the user picked survives),
 * drops nothing silently otherwise, and rejects anything that could not
 * possibly address a Tag — a malformed id must read as a bad request, never
 * as a Mongo cast error deep inside the write.
 *
 * `undefined` in means `undefined` out: "leave the entry's tags alone" is a
 * different instruction from "set the entry's tags to none", and only an
 * explicit `[]` means the latter. Do NOT give this a default.
 */
export const normalizeTagIds = (
  tagIds: readonly string[] | undefined,
): string[] | undefined => {
  if (tagIds === undefined) return undefined;

  const unique = [...new Set(tagIds)];
  if (unique.length > MAX_ENTRY_TAGS) {
    throw badRequest(`An entry can carry at most ${MAX_ENTRY_TAGS} tags`);
  }
  if (unique.some((id) => !mongoose.isValidObjectId(id))) {
    throw badRequest("Unknown tag");
  }
  return unique;
};

/**
 * Normalize, then prove every id belongs to the caller.
 *
 * One `countDocuments` scoped by `workspaceId` answers both "does it exist?"
 * and "is it in this workspace?" — a mismatch is a BAD_REQUEST rather than a
 * NOT_FOUND because the caller told us about a tag we cannot honour, and
 * answering "not found" would leak that another workspace's tag has that id.
 */
export const resolveTagIds = async (
  workspaceId: string,
  tagIds: readonly string[] | undefined,
): Promise<string[] | undefined> => {
  const unique = normalizeTagIds(tagIds);
  if (unique === undefined || unique.length === 0) return unique;

  const found = await Tag.countDocuments({
    workspaceId,
    _id: { $in: unique },
  });
  if (found !== unique.length) {
    throw badRequest("One or more tags do not exist");
  }
  return unique;
};

/**
 * The lenient counterpart, for ids the SERVER copied rather than the caller
 * supplying them (`continue`). A tag that vanished between the original entry
 * and now must not make continuing that work fail — the right answer is to
 * carry forward the labels that still exist and drop the ones that do not.
 */
export const filterKnownTagIds = async (
  workspaceId: string,
  tagIds: readonly string[] | undefined,
): Promise<string[]> => {
  const unique = normalizeTagIds(tagIds) ?? [];
  if (unique.length === 0) return [];

  const known = await Tag.find({ workspaceId, _id: { $in: unique } })
    .select("_id")
    .lean();
  const knownIds = new Set(known.map((tag) => String(tag._id)));
  return unique.filter((id) => knownIds.has(id));
};
