import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "../models/Client.js";
import { Project } from "../models/Project.js";
import { Task } from "../models/Task.js";

// These validate the schema in memory — `new Model(...).validateSync()` runs
// the validators without touching MongoDB, so the suite still needs no
// database connection.
//
// Regression: `createdBy` was declared required with a default of "" on all
// three models. Mongoose's String required validator rejects "" because it
// tests for a non-empty string, so any write that leaves `createdBy` to its
// default — a migration, a seed script, a backfill — failed with
// "Path `createdBy` is required". Same trap as TimeEntry.description.

test("a client with no createdBy at all is valid", () => {
  const client = new Client({
    workspaceId: "workspace-1",
    name: "Acme",
  });

  assert.equal(client.validateSync(), undefined);
  assert.equal(client.createdBy, "");
});

test("a project with no createdBy at all is valid", () => {
  const project = new Project({
    workspaceId: "workspace-1",
    name: "Redesign",
  });

  assert.equal(project.validateSync(), undefined);
  assert.equal(project.createdBy, "");
});

test("a task with no createdBy at all is valid", () => {
  const task = new Task({
    workspaceId: "workspace-1",
    projectId: "project-1",
    name: "Write the migration",
  });

  assert.equal(task.validateSync(), undefined);
  assert.equal(task.createdBy, "");
});

test("an explicit createdBy is still kept", () => {
  const client = new Client({
    workspaceId: "workspace-1",
    createdBy: "user-1",
    name: "Acme",
  });
  const project = new Project({
    workspaceId: "workspace-1",
    createdBy: "user-1",
    name: "Redesign",
  });
  const task = new Task({
    workspaceId: "workspace-1",
    createdBy: "user-1",
    projectId: "project-1",
    name: "Write the migration",
  });

  assert.equal(client.validateSync(), undefined);
  assert.equal(project.validateSync(), undefined);
  assert.equal(task.validateSync(), undefined);
  assert.equal(client.createdBy, "user-1");
  assert.equal(project.createdBy, "user-1");
  assert.equal(task.createdBy, "user-1");
});
