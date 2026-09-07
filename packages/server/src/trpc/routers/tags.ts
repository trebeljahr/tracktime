// The tRPC surface over the tag services. Logic lives in
// `services/catalog/tags.ts`, which the public REST API calls directly.
import {
  createTagSchema,
  idInputSchema,
  tagListSchema,
  updateTagSchema,
  type Tag as TagWire,
  type TagRemoveResult,
} from "@starter/shared";
import { scopeFromContext } from "../../services/scope.js";
import {
  createTag,
  listTags,
  removeTag,
  updateTag,
  type TagWithStats,
} from "../../services/catalog/tags.js";
import { workspaceProcedure, router } from "../trpc.js";

/** Re-exported: the client and the sibling routers import them from here. */
export { TAG_COLOR_OFFSET } from "../../services/catalog/tags.js";
export type { TagWithStats };
/** Declared in `@starter/shared`, so every client renders the same outcome. */
export type { TagRemoveResult };

export const tagsRouter = router({
  /** Every tag for this workspace, name-sorted, with rolled-up totals. */
  list: workspaceProcedure
    .input(tagListSchema)
    .query(async ({ ctx, input }): Promise<TagWithStats[]> =>
      listTags(scopeFromContext(ctx), input),
    ),

  create: workspaceProcedure
    .input(createTagSchema)
    .mutation(async ({ ctx, input }): Promise<TagWire> =>
      createTag(scopeFromContext(ctx), input),
    ),

  update: workspaceProcedure
    .input(updateTagSchema)
    .mutation(async ({ ctx, input }): Promise<TagWire> =>
      updateTag(scopeFromContext(ctx), input),
    ),

  /** Hard-deletes only when nothing references the tag; archives otherwise. */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<TagRemoveResult> =>
      removeTag(scopeFromContext(ctx), input),
    ),
});
