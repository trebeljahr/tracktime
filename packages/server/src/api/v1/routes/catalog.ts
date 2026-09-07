// Catalog routes — clients, projects, tasks, tags.
//
// Four resources with the same six shapes, so the handlers are generated from
// one factory rather than written out twenty-two times. Writing them out is
// how one of the twenty-two quietly forgets to merge the path id, or projects
// money on three resources and not the fourth.
import type { Response } from "express";
import type { z } from "zod";
import {
  clientListSchema,
  createClientSchema,
  createProjectSchema,
  createTagSchema,
  createTaskSchema,
  projectListSchema,
  tagListSchema,
  taskListSchema,
  updateClientSchema,
  updateProjectSchema,
  updateTagSchema,
  updateTaskSchema,
  projectProjectForVisibility,
  type Visibility,
} from "@starter/shared";
import { scopeFromApiToken, type WorkspaceScope } from "../../../services/scope.js";
import {
  archiveClient,
  createClient,
  getClient,
  listClients,
  removeClient,
  updateClient,
} from "../../../services/catalog/clients.js";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  removeProject,
  updateProject,
} from "../../../services/catalog/projects.js";
import {
  archiveTask,
  createTask,
  getTask,
  listTasks,
  removeTask,
  updateTask,
} from "../../../services/catalog/tasks.js";
import {
  createTag,
  getTag,
  listTags,
  removeTag,
  updateTag,
} from "../../../services/catalog/tags.js";
import type { ApiHandler, ApiHandlers, AuthedRequest } from "../auth.js";
import { sendData, sendList } from "../envelope.js";
import { asObject, coerceQuery, parseWith } from "../query.js";
import { archiveBodySchema, idPathSchema } from "../routes-table.js";

/**
 * The six handlers one catalog resource needs.
 *
 * Fully generic rather than cast: the input types are INFERRED from the zod
 * schemas, so declaring a resource with a schema its service function does not
 * accept is a compile error. A `never`/`any` shortcut here would have silently
 * accepted, say, `updateTagSchema` wired to `updateTask`.
 *
 * `archive` is optional because tags have none: `DELETE /tags/:id` archives
 * instead of deleting when tracked time still carries the tag, and reports
 * which of the two it did. A second route into the same state would be a
 * second place for that rule to live.
 */
type CatalogResource<
  TListed,
  TGot,
  TSingle,
  TList,
  TCreate,
  TUpdate,
> = {
  path: string;
  listSchema: z.ZodType<TList>;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  list: (scope: WorkspaceScope, input: TList) => Promise<TListed[]>;
  get: (scope: WorkspaceScope, id: string) => Promise<TGot>;
  create: (scope: WorkspaceScope, input: TCreate) => Promise<TSingle>;
  update: (scope: WorkspaceScope, input: TUpdate) => Promise<TSingle>;
  archive?: (
    scope: WorkspaceScope,
    input: { id: string; archived?: boolean; originId?: string },
  ) => Promise<TSingle>;
  remove: (
    scope: WorkspaceScope,
    input: { id: string; originId?: string },
  ) => Promise<unknown>;
  /**
   * The visibility projection, for resources that carry money.
   *
   * Three hooks rather than one because the three reads hand back three
   * different shapes, and a single hook would have to be typed loosely enough
   * to accept all of them — which is how one of the three ends up unprojected.
   * Every route that returns this resource goes through one of them, including
   * the create/update/archive responses: a write that echoes back what a read
   * would have withheld is the same leak by another verb.
   *
   * The rule itself lives in `projectProjectForVisibility`
   * (@starter/shared/visibility) and is written down exactly once there.
   *
   * There is deliberately no fourth hook for `delete`. Its collateral counts
   * are narrowed one layer down, in the service, because the honest answer for
   * a caller who may not see others' work is their OWN detached count — and
   * only the service can take it, before the cascade detaches everything and
   * the count is gone. Doing it there fixes the tRPC verb at the same time;
   * doing it here would have left `catalog.remove` handing the same number to
   * the web app.
   */
  projectRow?: (row: TListed, visibility: Visibility) => TListed;
  projectOne?: (row: TGot, visibility: Visibility) => TGot;
  projectSingle?: (row: TSingle, visibility: Visibility) => TSingle;
};

function buildHandlers<TListed, TGot, TSingle, TList, TCreate, TUpdate>(
  resource: CatalogResource<TListed, TGot, TSingle, TList, TCreate, TUpdate>,
): Record<string, ApiHandler> {
  const { path } = resource;

  // Resolved once, so every write route below is projected by construction
  // rather than by each handler remembering to ask.
  const projectSingle = (row: TSingle, scope: WorkspaceScope): TSingle =>
    resource.projectSingle
      ? resource.projectSingle(row, scope.visibility)
      : row;

  const handlers: Record<string, ApiHandler> = {
    [`get ${path}`]: async (req: AuthedRequest, res: Response) => {
      const scope = scopeFromApiToken(req.apiToken);
      const input = parseWith(
        resource.listSchema,
        coerceQuery(req.apiQuery, resource.listSchema),
      );
      const rows = await resource.list(scope, input);
      const projectRow = resource.projectRow;
      // Catalog lists are small and bounded by the workspace's own catalog, so
      // they are returned whole. `nextCursor` is still emitted as null rather
      // than omitted, so one list parser works across every list route.
      sendList(
        res,
        projectRow ? rows.map((row) => projectRow(row, scope.visibility)) : rows,
        null,
      );
    },

    [`get ${path}/:id`]: async (req: AuthedRequest, res: Response) => {
      const scope = scopeFromApiToken(req.apiToken);
      const { id } = parseWith(idPathSchema, req.params);
      const row = await resource.get(scope, id);
      const projectOne = resource.projectOne;
      sendData(res, projectOne ? projectOne(row, scope.visibility) : row);
    },

    [`post ${path}`]: async (req: AuthedRequest, res: Response) => {
      const scope = scopeFromApiToken(req.apiToken);
      const created = await resource.create(
        scope,
        parseWith(resource.createSchema, asObject(req.body)),
      );
      sendData(res, projectSingle(created, scope));
    },

    [`patch ${path}/:id`]: async (req: AuthedRequest, res: Response) => {
      const scope = scopeFromApiToken(req.apiToken);
      // The path is authoritative for the id: whatever the body claims is
      // overwritten, so `PATCH /clients/A` can never edit client B.
      const input = parseWith(resource.updateSchema, {
        ...asObject(req.body),
        id: req.params.id,
      });
      sendData(res, projectSingle(await resource.update(scope, input), scope));
    },

    [`delete ${path}/:id`]: async (req: AuthedRequest, res: Response) => {
      const scope = scopeFromApiToken(req.apiToken);
      const { id } = parseWith(idPathSchema, req.params);
      sendData(res, await resource.remove(scope, { id }));
    },
  };

  const archive = resource.archive;
  if (archive) {
    handlers[`post ${path}/:id/archive`] = async (
      req: AuthedRequest,
      res: Response,
    ) => {
      const scope = scopeFromApiToken(req.apiToken);
      const { id } = parseWith(idPathSchema, req.params);
      const body = parseWith(archiveBodySchema, asObject(req.body));
      sendData(res, projectSingle(await archive(scope, { id, ...body }), scope));
    };
  }

  return handlers;
}

export const catalogHandlers: ApiHandlers = {
  ...buildHandlers({
    path: "/clients",
    listSchema: clientListSchema,
    createSchema: createClientSchema,
    updateSchema: updateClientSchema,
    list: listClients,
    get: getClient,
    create: createClient,
    update: updateClient,
    archive: archiveClient,
    remove: removeClient,
  }),
  ...buildHandlers({
    path: "/projects",
    listSchema: projectListSchema,
    createSchema: createProjectSchema,
    updateSchema: updateProjectSchema,
    list: listProjects,
    get: getProject,
    create: createProject,
    update: updateProject,
    archive: archiveProject,
    remove: removeProject,
    // Projects are the only catalog resource carrying money, so they are the
    // only one with a projection — see the rule in @starter/shared/visibility.
    projectRow: projectProjectForVisibility,
    projectOne: projectProjectForVisibility,
    projectSingle: projectProjectForVisibility,
  }),
  ...buildHandlers({
    path: "/tasks",
    listSchema: taskListSchema,
    createSchema: createTaskSchema,
    updateSchema: updateTaskSchema,
    list: listTasks,
    get: getTask,
    create: createTask,
    update: updateTask,
    archive: archiveTask,
    remove: removeTask,
  }),
  ...buildHandlers({
    path: "/tags",
    listSchema: tagListSchema,
    createSchema: createTagSchema,
    updateSchema: updateTagSchema,
    list: listTags,
    get: getTag,
    create: createTag,
    update: updateTag,
    remove: removeTag,
  }),
};
