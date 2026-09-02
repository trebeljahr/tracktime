import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { quickStartKey, quickStartHint } from "@starter/shared";
import {
  collapseRecents,
  emptyCatalog,
  resolveQuickStartLabels,
  type CatalogLookup,
  type RecentSourceEntry,
} from "../trpc/routers/quick-start.js";

const ACME = "aaaaaaaaaaaaaaaaaaaaaaa1";
const RETIRED = "aaaaaaaaaaaaaaaaaaaaaaa2";
const GONE = "aaaaaaaaaaaaaaaaaaaaaaa3";
const TASK = "bbbbbbbbbbbbbbbbbbbbbbb1";
const CLIENT = "ccccccccccccccccccccccc1";

const catalog: CatalogLookup = {
  projects: new Map([
    [
      ACME,
      { name: "Acme", color: "#4f46e5", clientId: CLIENT, archived: false },
    ],
    [
      RETIRED,
      { name: "Old Site", color: "#64748b", clientId: null, archived: true },
    ],
  ]),
  tasks: new Map([[TASK, { name: "Invoicing", projectId: ACME }]]),
  clients: new Map([[CLIENT, "Acme Inc"]]),
};

/** An entry with everything defaulted, so each test states only what it means. */
const entry = (
  overrides: Partial<RecentSourceEntry> & Pick<RecentSourceEntry, "id">,
): RecentSourceEntry => ({
  description: "Writing",
  projectId: null,
  taskId: null,
  billable: false,
  start: "2026-08-01T09:00:00.000Z",
  end: "2026-08-01T10:00:00.000Z",
  ...overrides,
});

describe("resolveQuickStartLabels", () => {
  it("joins a project through to its client", () => {
    const labels = resolveQuickStartLabels(
      { projectId: ACME, taskId: TASK },
      catalog,
    );
    assert.equal(labels.projectName, "Acme");
    assert.equal(labels.projectColor, "#4f46e5");
    assert.equal(labels.clientName, "Acme Inc");
    assert.equal(labels.taskName, "Invoicing");
    assert.equal(labels.projectMissing, false);
    assert.equal(labels.taskMissing, false);
  });

  it("keeps an archived project's real name and flags it", () => {
    const labels = resolveQuickStartLabels(
      { projectId: RETIRED, taskId: null },
      catalog,
    );
    assert.equal(labels.projectName, "Old Site");
    assert.equal(labels.projectArchived, true);
    assert.equal(labels.projectMissing, false);
  });

  it("reports a project this owner no longer has as missing, with no name", () => {
    const labels = resolveQuickStartLabels(
      { projectId: GONE, taskId: null },
      catalog,
    );
    assert.equal(labels.projectMissing, true);
    assert.equal(labels.projectName, null);
    assert.equal(labels.projectColor, null);
    assert.equal(labels.clientName, null);
  });

  it("flags a missing task independently of the project", () => {
    const labels = resolveQuickStartLabels(
      { projectId: ACME, taskId: GONE },
      catalog,
    );
    assert.equal(labels.projectName, "Acme");
    assert.equal(labels.taskMissing, true);
    assert.equal(labels.taskName, null);
  });

  it("resolves nothing for a quick start with no references", () => {
    const labels = resolveQuickStartLabels(
      { projectId: null, taskId: null },
      emptyCatalog(),
    );
    assert.equal(labels.projectMissing, false);
    assert.equal(labels.taskMissing, false);
    assert.equal(labels.projectName, null);
  });

  it("never renders a raw id — a missing project reads as prose", () => {
    const labels = resolveQuickStartLabels(
      { projectId: GONE, taskId: null },
      catalog,
    );
    const hint = quickStartHint({
      description: "Writing",
      projectId: GONE,
      taskId: null,
      billable: false,
      ...labels,
    });
    assert.equal(hint, "Project deleted");
    assert.ok(hint !== null && !hint.includes(GONE));
  });
});

describe("collapseRecents — deduplication", () => {
  it("keeps one row per (description, project, task, billable)", () => {
    const recents = collapseRecents(
      [
        entry({ id: "3", start: "2026-08-03T09:00:00.000Z" }),
        entry({ id: "2", start: "2026-08-02T09:00:00.000Z" }),
        entry({ id: "1", start: "2026-08-01T09:00:00.000Z" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.equal(recents.length, 1);
    assert.equal(recents[0]?.count, 3);
  });

  it("takes its timestamps from the newest copy, not the first seen", () => {
    const recents = collapseRecents(
      [
        entry({ id: "1", start: "2026-08-01T09:00:00.000Z" }),
        entry({ id: "3", start: "2026-08-03T09:00:00.000Z" }),
        entry({ id: "2", start: "2026-08-02T09:00:00.000Z" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.equal(recents[0]?.lastEntryId, "3");
    assert.equal(recents[0]?.lastStart, "2026-08-03T09:00:00.000Z");
  });

  it("treats a different project, task or billable flag as a different job", () => {
    const recents = collapseRecents(
      [
        entry({ id: "1" }),
        entry({ id: "2", projectId: ACME }),
        entry({ id: "3", projectId: ACME, taskId: TASK }),
        entry({ id: "4", billable: true }),
      ],
      catalog,
      10,
    );
    assert.equal(recents.length, 4);
  });

  it("folds descriptions that differ only in surrounding whitespace", () => {
    const recents = collapseRecents(
      [entry({ id: "2", description: "  Writing  " }), entry({ id: "1" })],
      emptyCatalog(),
      10,
    );
    assert.equal(recents.length, 1);
    assert.equal(recents[0]?.description, "Writing");
  });

  it("keeps descriptions that differ only in case apart", () => {
    const recents = collapseRecents(
      [entry({ id: "2", description: "writing" }), entry({ id: "1" })],
      emptyCatalog(),
      10,
    );
    assert.equal(recents.length, 2);
  });

  it("emits a key that matches quickStartKey, so a pin can be spotted", () => {
    const [recent] = collapseRecents(
      [entry({ id: "1", projectId: ACME, billable: true })],
      catalog,
      10,
    );
    assert.ok(recent);
    assert.equal(
      recent.key,
      quickStartKey({
        description: "Writing",
        projectId: ACME,
        taskId: null,
        billable: true,
      }),
    );
  });
});

describe("collapseRecents — ordering", () => {
  it("sorts newest first regardless of the order it was handed", () => {
    const recents = collapseRecents(
      [
        entry({ id: "b", description: "Middle", start: "2026-08-02T09:00:00.000Z" }),
        entry({ id: "c", description: "Oldest", start: "2026-08-01T09:00:00.000Z" }),
        entry({ id: "a", description: "Newest", start: "2026-08-03T09:00:00.000Z" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.deepEqual(
      recents.map((recent) => recent.description),
      ["Newest", "Middle", "Oldest"],
    );
  });

  it("breaks a tied start by id descending, as entries.list does", () => {
    const recents = collapseRecents(
      [
        entry({ id: "a1", description: "First" }),
        entry({ id: "a2", description: "Second" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.deepEqual(
      recents.map((recent) => recent.description),
      ["Second", "First"],
    );
  });

  it("applies the limit after collapsing, so duplicates do not eat slots", () => {
    const recents = collapseRecents(
      [
        entry({ id: "1", description: "A", start: "2026-08-05T09:00:00.000Z" }),
        entry({ id: "2", description: "A", start: "2026-08-04T09:00:00.000Z" }),
        entry({ id: "3", description: "B", start: "2026-08-03T09:00:00.000Z" }),
        entry({ id: "4", description: "C", start: "2026-08-02T09:00:00.000Z" }),
      ],
      emptyCatalog(),
      2,
    );
    assert.deepEqual(
      recents.map((recent) => recent.description),
      ["A", "B"],
    );
  });

  it("returns nothing for a limit of zero", () => {
    assert.deepEqual(
      collapseRecents([entry({ id: "1" })], emptyCatalog(), 0),
      [],
    );
  });
});

describe("collapseRecents — what it refuses to offer", () => {
  it("skips the running entry, which cannot be restarted without shredding it", () => {
    const recents = collapseRecents(
      [
        entry({ id: "1", description: "Running", end: null }),
        entry({ id: "2", description: "Finished" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.deepEqual(
      recents.map((recent) => recent.description),
      ["Finished"],
    );
  });

  it("still offers the combination when an older finished copy exists", () => {
    const recents = collapseRecents(
      [
        entry({ id: "2", start: "2026-08-02T09:00:00.000Z", end: null }),
        entry({ id: "1", start: "2026-08-01T09:00:00.000Z" }),
      ],
      emptyCatalog(),
      10,
    );
    assert.equal(recents.length, 1);
    assert.equal(recents[0]?.lastEntryId, "1");
    assert.equal(recents[0]?.count, 1);
  });

  it("drops an entry whose start cannot be parsed rather than sorting on NaN", () => {
    const recents = collapseRecents(
      [entry({ id: "1", start: "not a date" }), entry({ id: "2" })],
      emptyCatalog(),
      10,
    );
    assert.deepEqual(
      recents.map((recent) => recent.lastEntryId),
      ["2"],
    );
  });

  it("returns an empty list for an empty window", () => {
    assert.deepEqual(collapseRecents([], emptyCatalog(), 5), []);
  });
});

describe("collapseRecents — archived and deleted projects", () => {
  it("labels a recent on an archived project instead of hiding it", () => {
    const [recent] = collapseRecents(
      [entry({ id: "1", projectId: RETIRED })],
      catalog,
      10,
    );
    assert.ok(recent);
    assert.equal(recent.projectName, "Old Site");
    assert.equal(recent.projectArchived, true);
    assert.equal(
      quickStartHint(recent),
      "Old Site (archived)",
    );
  });

  it("keeps a recent whose project is gone, flagged rather than mislabelled", () => {
    const [recent] = collapseRecents(
      [entry({ id: "1", projectId: GONE })],
      catalog,
      10,
    );
    assert.ok(recent);
    assert.equal(recent.projectMissing, true);
    assert.equal(recent.projectName, null);
    assert.equal(recent.projectId, GONE);
  });

  it("distinguishes an archived project from a deleted one", () => {
    const recents = collapseRecents(
      [
        entry({ id: "2", projectId: RETIRED, start: "2026-08-02T09:00:00.000Z" }),
        entry({ id: "1", projectId: GONE, start: "2026-08-01T09:00:00.000Z" }),
      ],
      catalog,
      10,
    );
    assert.deepEqual(
      recents.map((recent) => [recent.projectArchived, recent.projectMissing]),
      [
        [true, false],
        [false, true],
      ],
    );
  });
});
