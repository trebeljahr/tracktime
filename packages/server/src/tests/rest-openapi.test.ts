// The route table is the single source of truth. These tests are what makes
// that claim true rather than aspirational.
//
// Three ways it fails silently:
//  - a route in the table with no handler: the document advertises an endpoint
//    that answers 404. Mounting throws instead, so this is checked by mounting.
//  - `/entries/:id` registered before `/entries/current`: Express matches the
//    parameterised route first and looks "current" up as an entry id, so a
//    running timer reads as missing.
//  - a route that quietly requires the wrong scope, or none. The scope of every
//    route is written out below, so changing one is a deliberate edit here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import type { ApiTokenScope } from "@starter/shared/api-tokens";
import { registerApiV1Routes } from "../api/v1/index.js";
import { buildOpenApiDocument } from "../api/v1/openapi.js";
import { API_ROUTES, LIST_ROUTES } from "../api/v1/routes-table.js";

const key = (method: string, path: string): string => `${method} ${path}`;

/**
 * Every route, and the scope it requires. Written out rather than derived, so
 * that widening a route — `catalog:read` where `catalog:write` belongs, or
 * `null` where a scope belongs — cannot land without editing this list.
 */
const EXPECTED_SCOPES: Readonly<Record<string, ApiTokenScope | null>> = {
  "get /entries": "entries:read",
  "get /entries/current": "entries:read",
  "get /entries/:id": "entries:read",
  "post /entries": "entries:write",
  "patch /entries/:id": "entries:write",
  "delete /entries/:id": "entries:write",
  "post /entries/start": "entries:write",
  "post /entries/stop": "entries:write",

  "get /clients": "catalog:read",
  "get /clients/:id": "catalog:read",
  "post /clients": "catalog:write",
  "patch /clients/:id": "catalog:write",
  "post /clients/:id/archive": "catalog:write",
  "delete /clients/:id": "catalog:write",

  "get /projects": "catalog:read",
  "get /projects/:id": "catalog:read",
  "post /projects": "catalog:write",
  "patch /projects/:id": "catalog:write",
  "post /projects/:id/archive": "catalog:write",
  "delete /projects/:id": "catalog:write",

  "get /tasks": "catalog:read",
  "get /tasks/:id": "catalog:read",
  "post /tasks": "catalog:write",
  "patch /tasks/:id": "catalog:write",
  "post /tasks/:id/archive": "catalog:write",
  "delete /tasks/:id": "catalog:write",

  "get /tags": "catalog:read",
  "get /tags/:id": "catalog:read",
  "post /tags": "catalog:write",
  "patch /tags/:id": "catalog:write",
  "delete /tags/:id": "catalog:write",

  "get /reports/summary": "reports:read",
  "get /reports/detailed": "reports:read",
  "get /reports/weekly": "reports:read",

  "get /me": null,
  "get /openapi.json": null,
};

describe("API_ROUTES", () => {
  it("mounts, which is how a route without a handler is caught", () => {
    // `mount` throws at startup for a table entry with no handler: a
    // documented endpoint that answers 404 is worse than a boot failure,
    // because only the boot failure is noticed.
    const app = express();
    app.use(express.json());
    assert.doesNotThrow(() => registerApiV1Routes(app));
  });

  it("requires the scope this list says, on every route", () => {
    const actual = Object.fromEntries(
      API_ROUTES.map((route) => [key(route.method, route.path), route.scope]),
    );
    assert.deepEqual(actual, EXPECTED_SCOPES);
  });

  it("registers /entries/current before /entries/:id", () => {
    const current = API_ROUTES.findIndex((r) => r.path === "/entries/current");
    const byId = API_ROUTES.findIndex((r) => r.path === "/entries/:id");
    assert.ok(current !== -1 && byId !== -1);
    assert.ok(current < byId, "/entries/current must be mounted first or it is shadowed");
  });

  it("exposes exactly one route without a token, and it carries no data", () => {
    const open = API_ROUTES.filter((route) => route.isPublic === true);
    assert.deepEqual(
      open.map((route) => route.path),
      ["/openapi.json"],
    );
    // It describes shapes, never rows: nothing about it reads a workspace.
    assert.equal(open[0]?.output, null);
  });

  it("has no duplicate method+path", () => {
    const keys = API_ROUTES.map((route) => key(route.method, route.path));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("declares a request schema for everything that takes input", () => {
    for (const route of API_ROUTES) {
      if (route.method === "post" || route.method === "patch") {
        assert.ok(route.input, `${key(route.method, route.path)} takes a body`);
      }
      if (route.path.includes(":") && route.method !== "patch" && route.method !== "post") {
        assert.equal(route.input?.source, "path", key(route.method, route.path));
      }
    }
  });
});

describe("list envelopes", () => {
  it("wraps every list route as { data: [...], nextCursor }", () => {
    for (const routeKey of LIST_ROUTES) {
      const route = API_ROUTES.find((r) => key(r.method, r.path) === routeKey);
      assert.ok(route, routeKey);
      assert.ok(route.output, routeKey);
      const shape = route.output.safeParse({ data: [], nextCursor: null });
      assert.equal(shape.success, true, `${routeKey} must accept an empty last page`);
      // `nextCursor` present-and-null on the last page, never absent: absent
      // would make "no more pages" and "the serializer dropped a field"
      // indistinguishable, and a paging client just stops early.
      assert.equal(
        route.output.safeParse({ data: [] }).success,
        false,
        `${routeKey} must not accept a missing nextCursor`,
      );
    }
  });

  it("keeps the detailed report's range totals beside its page", () => {
    // It pages like a list but is not one: `totalSec`/`totalAmount` span the
    // whole filtered range, not the page. Folding them into the rows would
    // make a client that sums the page disagree with the report's own total.
    const route = API_ROUTES.find((r) => r.path === "/reports/detailed");
    assert.ok(route?.output);
    assert.equal(route.output.safeParse({ data: [], nextCursor: null }).success, false);
    assert.equal(
      route.output.safeParse({
        data: [],
        nextCursor: null,
        totalSec: 0,
        totalAmount: 0,
        currency: "EUR",
      }).success,
      true,
    );
  });

  it("does not shape a single-resource route like a list", () => {
    const single = API_ROUTES.filter(
      (route) =>
        route.output !== null &&
        !LIST_ROUTES.has(key(route.method, route.path)) &&
        route.path !== "/reports/detailed",
    );
    for (const route of single) {
      assert.equal(
        route.output?.safeParse({ data: [], nextCursor: null }).success,
        false,
        key(route.method, route.path),
      );
    }
  });
});

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument() as {
    openapi: string;
    security: unknown[];
    components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };

  it("documents every route in the table, and nothing else", () => {
    const documented = new Set<string>();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const method of Object.keys(operations)) {
        documented.add(`${method} ${path}`);
      }
    }
    const expected = new Set(
      API_ROUTES.map(
        (route) =>
          `${route.method} /api/v1${route.path.replace(/:([A-Za-z_]\w*)/g, "{$1}")}`,
      ),
    );
    assert.deepEqual([...documented].sort(), [...expected].sort());
  });

  it("is OpenAPI 3.1 and requires the bearer token globally", () => {
    assert.equal(doc.openapi, "3.1.0");
    assert.deepEqual(doc.security, [{ bearerAuth: [] }]);
    assert.ok(doc.components.securitySchemes.bearerAuth);
    assert.ok(doc.components.schemas.Problem);
  });

  it("opts only the spec route out of that global requirement", () => {
    for (const route of API_ROUTES) {
      const path = `/api/v1${route.path.replace(/:([A-Za-z_]\w*)/g, "{$1}")}`;
      const operation = doc.paths[path]?.[route.method];
      assert.ok(operation, path);
      // `security: []` is how OpenAPI spells "no credential needed" inside a
      // document that otherwise requires one.
      assert.equal(
        "security" in operation,
        route.isPublic === true,
        `${route.method} ${path}`,
      );
    }
  });

  it("names the required scope on the operation itself", () => {
    for (const route of API_ROUTES) {
      const path = `/api/v1${route.path.replace(/:([A-Za-z_]\w*)/g, "{$1}")}`;
      const operation = doc.paths[path]?.[route.method] as Record<string, unknown>;
      assert.equal(operation["x-required-scope"], route.scope ?? undefined, path);
    }
  });

  it("documents an id as a path parameter and not as a body field", () => {
    // The shared update schemas carry `id` because tRPC has nowhere else to
    // put it, and zod will not let a refined object omit a field. The handler
    // overwrites it from the path, so documenting it in the body would mark a
    // correct request invalid.
    const patch = doc.paths["/api/v1/entries/{id}"]?.patch as {
      parameters: { name: string; in: string; required: boolean }[];
      requestBody: {
        content: {
          "application/json": { schema: { properties: Record<string, unknown>; required?: string[] } };
        };
      };
    };
    assert.ok(patch.parameters.some((p) => p.name === "id" && p.in === "path" && p.required));
    const body = patch.requestBody.content["application/json"].schema;
    assert.equal("id" in body.properties, false);
    assert.equal((body.required ?? []).includes("id"), false);
  });

  it("splits a query schema into named parameters", () => {
    const list = doc.paths["/api/v1/entries"]?.get as {
      parameters: { name: string; in: string; required: boolean; explode?: boolean }[];
    };
    const byName = new Map(list.parameters.map((p) => [p.name, p]));
    assert.equal(byName.get("from")?.required, true);
    assert.equal(byName.get("limit")?.required, false);
    // Repeated keys, which is the spelling every generator emits.
    assert.equal(byName.get("projectIds")?.explode, true);
  });

  it("documents the error statuses a client has to handle", () => {
    const get = doc.paths["/api/v1/entries"]?.get as { responses: Record<string, unknown> };
    // An undocumented status is an unhandled exception in somebody's
    // integration — a generated client only handles what the spec mentions.
    for (const status of ["200", "400", "401", "403", "429", "500"]) {
      assert.ok(status in get.responses, status);
    }
    const spec = doc.paths["/api/v1/openapi.json"]?.get as { responses: Record<string, unknown> };
    assert.deepEqual(Object.keys(spec.responses), ["200"]);
  });
});
