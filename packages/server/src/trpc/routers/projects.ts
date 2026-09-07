// The tRPC surface over the project services. Logic lives in
// `services/catalog/projects.ts`, which the public REST API calls directly.
import {
  createProjectSchema,
  idInputSchema,
  projectListSchema,
  updateProjectSchema,
  type Project as ProjectWire,
} from "@starter/shared";
import { scopeFromContext } from "../../services/scope.js";
import {
  archiveProject,
  createProject,
  listProjects,
  removeProject,
  updateProject,
  type ProjectWithStats,
} from "../../services/catalog/projects.js";
import { workspaceProcedure, router } from "../trpc.js";
import type { CatalogRemoveResult } from "./catalog-cascade.js";
import { archiveInputSchema } from "./clients.js";

/** Re-exported: the client and the sibling routers import it from here. */
export type { ProjectWithStats };

export const projectsRouter = router({
  list: workspaceProcedure
    .input(projectListSchema)
    .query(async ({ ctx, input }): Promise<ProjectWithStats[]> =>
      listProjects(scopeFromContext(ctx), input),
    ),

  create: workspaceProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> =>
      createProject(scopeFromContext(ctx), input),
    ),

  update: workspaceProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> =>
      updateProject(scopeFromContext(ctx), input),
    ),

  archive: workspaceProcedure
    .input(archiveInputSchema)
    .mutation(async ({ ctx, input }): Promise<ProjectWire> =>
      archiveProject(scopeFromContext(ctx), input),
    ),

  /**
   * Always deletes. Tasks go with the project; entries booked on either keep
   * their tracked time and become project-less. Use `archive` to keep the
   * project around instead.
   */
  remove: workspaceProcedure
    .input(idInputSchema)
    .mutation(async ({ ctx, input }): Promise<CatalogRemoveResult> =>
      removeProject(scopeFromContext(ctx), input),
    ),
});
