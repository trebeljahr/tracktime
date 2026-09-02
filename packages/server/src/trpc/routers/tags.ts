// IMPLEMENTED BY: tags agent
//
// Tags are cross-cutting labels, deliberately OUTSIDE the
// Client > Project > Task tree: one entry lives at exactly one place in that
// tree but can carry any number of tags. Same rules as the rest of the
// catalog apply — every query is scoped by `workspaceId`, a document owned by
// somebody else is NOT_FOUND rather than FORBIDDEN, and every mutation
// broadcasts `{ kind: "catalog.changed", scope: "tag" }` through
// `publishSync` so the other tabs and devices catch up.
import { TRPCError } from "@trpc/server";
import {
  createTagSchema,
  idInputSchema,
  tagListSchema,
  updateTagSchema,
  type Tag as TagWire,
} from "@starter/shared";
import { Tag, toClientTag } from "../../models/Tag.js";
import { TimeEntry } from "../../models/TimeEntry.js";
import { publishSync } from "../../ws/sync.js";
import { workspaceProcedure, router } from "../trpc.js";
import { assertObjectId, exactNameRegExp, pickCatalogColor } from "./clients.js";

/**
 * Where tags start in the shared catalog palette.
 *
 * Ten lands on violet — the same hue as `DEFAULT_TAG_COLOR` on the model — so
 * a tag created through the router and one written straight to the database
 * look alike, and a list of tags stays visually distinct from a list of
 * clients (offset 0) or projects (offset 6) created in lockstep.
 */
export const TAG_COLOR_OFFSET = 10;

/** A tag plus how much time carries it — what the tag manager lists. */
export type TagWithStats = TagWire & {
  /** Number of time entries carrying this tag. */
  entryCount: number;
  /** Sum of `durationSec` across those entries. */
  totalSec: number;
};

/** What every catalog `remove` resolves to — deletion is never guaranteed. */
export type TagRemoveResult = {
  deleted: boolean;
  archived: boolean;
  message: string | null;
};

/** Rolled-up usage for one tag, keyed by the tag's id as a string. */
type TagUsage = { entryCount: number; totalSec: number };

const conflict = (name: string): TRPCError =>
  new TRPCError({
    code: "CONFLICT",
    message: `A tag named "${name.trim()}" already exists.`,
  });

const notFound = (): TRPCError =>
  new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });

const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  return (error as { code?: unknown }).code === 11000;
};

/**
 * Reject a name that already exists for this owner.
 *
 * The unique index is the real enforcement (and is case-insensitive through
 * its collation); this check exists so the caller gets a CONFLICT with a
 * readable message instead of a raw duplicate-key error.
 */
const assertUniqueTagName = async (
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> => {
  const clash = await Tag.exists({
    workspaceId,
    name: exactNameRegExp(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) throw conflict(name);
};

/**
 * Usage totals for every tag this owner has used, in ONE aggregation.
 *
 * The alternative — asking "how much time carries this tag?" per tag — is an
 * N+1 that grows with the tag list. Unwinding `tagIds` once and grouping by
 * the id gives every tag's numbers in a single pass, and the empty-array
 * entries are filtered out before the unwind so untagged time never enters
 * the pipeline at all.
 */
const loadTagUsage = async (workspaceId: string): Promise<Map<string, TagUsage>> => {
  const rows = await TimeEntry.aggregate<{
    _id: string;
    entryCount: number;
    totalSec: number;
  }>([
    { $match: { workspaceId, "tagIds.0": { $exists: true } } },
    { $unwind: "$tagIds" },
    {
      $group: {
        _id: "$tagIds",
        entryCount: { $sum: 1 },
        totalSec: { $sum: "$durationSec" },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      { entryCount: row.entryCount, totalSec: row.totalSec },
    ]),
  );
};

export const tagsRouter = router({
  /** Every tag for this owner, name-sorted, with rolled-up totals. */
  list: workspaceProcedure
    .input(tagListSchema)
    .query(async ({ ctx, input }): Promise<TagWithStats[]> => {
      const workspaceId = ctx.workspaceId;

      const [docs, usage] = await Promise.all([
        Tag.find({
          workspaceId,
          ...(input.includeArchived ? {} : { archived: false }),
        })
          // Same collation as the unique index, so "design" and "Design"
          // sort next to each other rather than in two alphabets.
          .collation({ locale: "en", strength: 2 })
          .sort({ name: 1 })
          .lean(),
        loadTagUsage(workspaceId),
      ]);

      return docs.map((doc) => {
        const tag = toClientTag(doc);
        const stats = usage.get(tag.id);
        return {
          ...tag,
          entryCount: stats?.entryCount ?? 0,
          totalSec: stats?.totalSec ?? 0,
        };
      });
    }),

  create: workspaceProcedure
    .input(createTagSchema)
    .mutation(async ({ ctx, input }): Promise<TagWire> => {
      const workspaceId = ctx.workspaceId;
      const name = input.name.trim();
      if (name === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Name is required",
        });
      }
      await assertUniqueTagName(workspaceId, name);

      const existing = await Tag.countDocuments({ workspaceId });

      let created;
      try {
        created = await Tag.create({
          workspaceId,
          createdBy: ctx.user.id,
          name,
          color: input.color ?? pickCatalogColor(existing, TAG_COLOR_OFFSET),
          archived: false,
        });
      } catch (error) {
        // The check above lost a race with a concurrent create; the index
        // caught it. Same answer either way.
        if (isDuplicateKeyError(error)) throw conflict(name);
        throw error;
      }

      void publishSync(
        workspaceId,
        { kind: "catalog.changed", scope: "tag" },
        input.originId,
      );
      return toClientTag(created);
    }),

  update: workspaceProcedure
    .input(updateTagSchema)
    .mutation(async ({ ctx, input }): Promise<TagWire> => {
      const workspaceId = ctx.workspaceId;
      assertObjectId(input.id);

      const name = input.name?.trim();
      if (name !== undefined) {
        if (name === "") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Name is required",
          });
        }
        await assertUniqueTagName(workspaceId, name, input.id);
      }

      let updated;
      try {
        updated = await Tag.findOneAndUpdate(
          { _id: input.id, workspaceId },
          {
            $set: {
              ...(name !== undefined ? { name } : {}),
              ...(input.color !== undefined ? { color: input.color } : {}),
              ...(input.archived !== undefined
                ? { archived: input.archived }
                : {}),
            },
          },
          { returnDocument: "after" },
        ).lean();
      } catch (error) {
        if (isDuplicateKeyError(error) && name !== undefined) {
          throw conflict(name);
        }
        throw error;
      }

      if (!updated) throw notFound();

      void publishSync(
        workspaceId,
        { kind: "catalog.changed", scope: "tag" },
        input.originId,
      );
      return toClientTag(updated);
    }),

  /** Hard-deletes only when nothing references the tag; archives otherwise. */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<TagRemoveResult> => {
      const workspaceId = ctx.workspaceId;
      assertObjectId(input.id);

      const tag = await Tag.findOne({ _id: input.id, workspaceId }).lean();
      if (!tag) throw notFound();

      // A tag that still labels tracked time is ARCHIVED, not deleted — the
      // same rule clients and projects follow. Deleting it would silently
      // rewrite history: reports grouped by tag would lose a bucket and the
      // entries would have nothing to show in its place.
      const referenced =
        (await TimeEntry.exists({ workspaceId, tagIds: input.id })) !== null;

      if (referenced) {
        await Tag.updateOne({ _id: input.id, workspaceId }, { $set: { archived: true } });
        void publishSync(
          workspaceId,
          { kind: "catalog.changed", scope: "tag" },
          input.originId,
        );
        return {
          deleted: false,
          archived: true,
          message:
            "This tag is still on tracked time, so it was archived instead of deleted.",
        };
      }

      await Tag.deleteOne({ _id: input.id, workspaceId });

      // Belt and braces, and ordered on purpose: the `exists` check above and
      // this delete are not one transaction, so an entry written in between
      // would keep an id pointing at a tag that is gone — which renders as a
      // blank chip on the entry and as a phantom filter value. One updateMany
      // sweeps any such straggler, and running it AFTER the delete is what
      // makes it catch writes that landed during the check.
      await TimeEntry.updateMany(
        { workspaceId, tagIds: input.id },
        { $pull: { tagIds: input.id } },
      );

      void publishSync(
        workspaceId,
        { kind: "catalog.changed", scope: "tag" },
        input.originId,
      );
      return { deleted: true, archived: false, message: null };
    }),
});
