// Author-scoping for the entry roll-ups a catalog row carries.
//
// A project's `entryCount`/`totalSec`, a task's `totalSec` and a tag's usage
// are sums over the time entries booked on them. Unscoped, they are a
// whole-workspace disclosure that no entry-level permission check ever sees:
// a member with `canViewOthersTime: false` — who cannot read a single
// colleague entry through `/entries` or any report — gets the workspace's
// totals per project, per task and per tag, and by polling them daily
// differences out each colleague's booked hours. Nothing errors, nothing is
// logged, and the numbers look exactly as they should.
//
// So a roll-up runs under the SAME `authorScopeFilter` the entry list runs
// under (`services/entries/list.ts`). One helper rather than three copies,
// because three copies is how the tags one keeps its whole-workspace `$group`
// six months after the projects one was fixed.
//
// Pure and model-free on purpose: the pipeline these produce is asserted in
// `tests/catalog-visibility.test.ts` without a database, which is the only way
// a "did we remember the filter?" test can exist at all.
import type { PipelineStage } from "mongoose";
import type { Visibility } from "@starter/shared";
import { authorScopeFilter } from "../../models/WorkspaceMember.js";

/**
 * The `$match` of an entry roll-up, restricted to what `visibility` may see.
 *
 * Merged as a plain field condition alongside whatever the caller already
 * matches on (including an `$expr`), because `authorId` is an indexed equality
 * and belongs in the query, not in an expression Mongo cannot use the index
 * for.
 */
export function scopeRollupMatch(
  match: Record<string, unknown>,
  visibility: Visibility,
): Record<string, unknown> {
  const authorScope = authorScopeFilter(visibility);
  // Identity when nothing is restricted, so a caller who may see everything
  // runs exactly the pipeline that was there before.
  return authorScope === null ? match : { ...match, ...authorScope };
}

/** Which field on a time entry holds the catalog row's id. */
export type EntryRollupField = "projectId" | "taskId";

/**
 * The `$lookup` that rolls tracked time up onto one catalog row.
 *
 * Shared by projects and tasks, which differ only in that field name — and
 * differing in anything else is how `totalSec` comes to mean two things.
 */
export function catalogEntryRollup(args: {
  workspaceId: string;
  visibility: Visibility;
  entryField: EntryRollupField;
  as: string;
}): PipelineStage.Lookup {
  return {
    $lookup: {
      from: "timeentries",
      let: { rowId: { $toString: "$_id" } },
      pipeline: [
        {
          $match: scopeRollupMatch(
            {
              $expr: {
                $and: [
                  { $eq: ["$workspaceId", args.workspaceId] },
                  { $eq: [`$${args.entryField}`, "$$rowId"] },
                ],
              },
            },
            args.visibility,
          ),
        },
        {
          $group: {
            _id: null,
            entryCount: { $sum: 1 },
            totalSec: { $sum: "$durationSec" },
          },
        },
        { $project: { _id: 0, entryCount: 1, totalSec: 1 } },
      ],
      as: args.as,
    },
  };
}
