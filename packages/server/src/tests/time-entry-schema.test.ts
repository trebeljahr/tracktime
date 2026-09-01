import assert from "node:assert/strict";
import test from "node:test";
import { TimeEntry } from "../models/TimeEntry.js";

// These validate the schema in memory — `new Model(...).validateSync()` runs
// the validators without touching MongoDB, so the suite still needs no
// database connection.

test("an entry with no description at all is valid", () => {
  const entry = new TimeEntry({
    ownerId: "owner-1",
    start: new Date(),
    end: null,
    durationSec: 0,
    billable: false,
    currency: "EUR",
    source: "web",
  });

  // Regression: `description` was declared required with a default of "".
  // Mongoose's String required validator rejects "" because it tests for a
  // non-empty string, so starting a timer without typing anything first —
  // the most ordinary thing a user does — failed with
  // "TimeEntry validation failed: description: Path `description` is required".
  assert.equal(entry.validateSync(), undefined);
  assert.equal(entry.description, "");
});

test("an entry with an explicitly empty description is valid", () => {
  const entry = new TimeEntry({
    ownerId: "owner-1",
    description: "",
    start: new Date(),
    end: null,
    durationSec: 0,
    billable: false,
    currency: "EUR",
    source: "web",
  });

  assert.equal(entry.validateSync(), undefined);
  assert.equal(entry.description, "");
});

test("a described entry still validates and keeps its description", () => {
  const entry = new TimeEntry({
    ownerId: "owner-1",
    description: "Writing the bug report",
    start: new Date(),
    end: null,
    durationSec: 0,
    billable: false,
    currency: "EUR",
    source: "web",
  });

  assert.equal(entry.validateSync(), undefined);
  assert.equal(entry.description, "Writing the bug report");
});

test("ownerId is still required", () => {
  const entry = new TimeEntry({
    description: "no owner",
    start: new Date(),
    durationSec: 0,
    billable: false,
    currency: "EUR",
    source: "web",
  });

  const err = entry.validateSync();
  assert.ok(err, "expected a validation error for the missing ownerId");
  assert.ok("ownerId" in err.errors);
});

test("a description longer than the 500 character cap is rejected", () => {
  const entry = new TimeEntry({
    ownerId: "owner-1",
    description: "x".repeat(501),
    start: new Date(),
    durationSec: 0,
    billable: false,
    currency: "EUR",
    source: "web",
  });

  const err = entry.validateSync();
  assert.ok(err, "expected a validation error for the over-long description");
  assert.ok("description" in err.errors);
});
