// Duplicate-name refusal, for every catalog model at once.
//
// This was four near-identical copies (clients, projects, tasks, tags). They
// drifted in exactly the way copies do: the tasks one scoped by `projectId`
// too, the tags one caught the index's duplicate-key error as well. One
// parameterised helper means a fix to the matcher is a fix everywhere.
import { TRPCError } from "@trpc/server";

// The escaper is imported, never re-implemented: a second copy is one that
// eventually misses a metacharacter, and the failure is silent — a name
// lookup for `(a+)+$` reaching Mongo as a live pattern is a caller choosing
// how much CPU the query costs.
import { escapeRegExp } from "../entries/errors.js";

/**
 * Anchored, case-insensitive matcher used for duplicate-name checks.
 *
 * Case-insensitive because a name is something people type from memory:
 * "Design", "design" and "DESIGN" are one idea, and letting them become three
 * rows means a third of the hours ends up under each.
 */
export function exactNameRegExp(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name.trim())}$`, "i");
}

/**
 * The subset of a Mongoose model this needs. Structural rather than
 * `Model<T>`, so one helper serves four differently-typed models without an
 * `any` anywhere.
 */
type CatalogNameModel = {
  exists(filter: Record<string, unknown>): PromiseLike<unknown>;
};

export type AssertUniqueCatalogNameArgs = {
  model: CatalogNameModel;
  /** Everything that scopes the uniqueness — `workspaceId`, plus `projectId`
   *  for tasks, whose names are unique per project rather than per workspace. */
  filter: Record<string, unknown>;
  name: string;
  /** The row being edited, excluded so renaming to its own name is allowed. */
  excludeId?: string;
  /** What the thing is called in the refusal, e.g. "client". */
  label: string;
  /** Override for a model whose refusal does not fit the default phrasing. */
  message?: (trimmedName: string) => string;
};

/**
 * Reject a name that already exists in the given scope.
 *
 * The unique index is the real enforcement (and is case-insensitive through
 * its collation); this check exists so the caller gets a CONFLICT with a
 * readable message instead of a raw duplicate-key error.
 */
export async function assertUniqueCatalogName(
  args: AssertUniqueCatalogNameArgs,
): Promise<void> {
  const clash = await args.model.exists({
    ...args.filter,
    name: exactNameRegExp(args.name),
    ...(args.excludeId ? { _id: { $ne: args.excludeId } } : {}),
  });
  if (!clash) return;

  const trimmed = args.name.trim();
  throw new TRPCError({
    code: "CONFLICT",
    message: args.message
      ? args.message(trimmed)
      : `A ${args.label} named "${trimmed}" already exists.`,
  });
}
