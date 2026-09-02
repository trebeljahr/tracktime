import { describe, expect, it } from "vitest";
import {
  buildQuickStartInput,
  isBrokenQuickStart,
  mergeQuickStarts,
  quickStartHint,
  quickStartKey,
  quickStartLabel,
  repairQuickStart,
  sameQuickStart,
  toQuickStart,
  type DetailedFavorite,
  type QuickStart,
  type RecentEntry,
} from "@starter/core";

const PROJECT = "aaaaaaaaaaaaaaaaaaaaaaa1";
const TASK = "bbbbbbbbbbbbbbbbbbbbbbb1";

const quick = (overrides: Partial<QuickStart> = {}): QuickStart => ({
  description: "Writing",
  projectId: null,
  taskId: null,
  billable: false,
  ...overrides,
});

const labels = {
  projectName: null,
  projectColor: null,
  clientName: null,
  taskName: null,
  projectMissing: false,
  projectArchived: false,
  taskMissing: false,
};

const favorite = (
  overrides: Partial<DetailedFavorite> = {},
): DetailedFavorite => ({
  id: "fav-1",
  workspaceId: "w1",
  userId: "owner",
  ...quick(),
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...labels,
  ...overrides,
});

const recent = (overrides: Partial<RecentEntry> = {}): RecentEntry => {
  const base = { ...quick(), ...overrides };
  return {
    ...base,
    ...labels,
    key: quickStartKey(base),
    lastStart: "2026-08-01T09:00:00.000Z",
    lastEntryId: "entry-1",
    count: 1,
    ...overrides,
  };
};

describe("quickStartKey", () => {
  it("is stable across objects with the same four fields", () => {
    expect(quickStartKey(quick({ projectId: PROJECT }))).toBe(
      quickStartKey(quick({ projectId: PROJECT })),
    );
    expect(sameQuickStart(quick(), quick())).toBe(true);
  });

  it("separates a null project from a null task", () => {
    expect(quickStartKey(quick({ projectId: PROJECT }))).not.toBe(
      quickStartKey(quick({ taskId: PROJECT })),
    );
  });

  it("does not collide when a description contains the field separators", () => {
    expect(quickStartKey(quick({ description: "a|b" }))).not.toBe(
      quickStartKey(quick({ description: "a", projectId: "b" })),
    );
  });

  it("ignores surrounding whitespace but not case", () => {
    expect(sameQuickStart(quick(), quick({ description: " Writing " }))).toBe(
      true,
    );
    expect(sameQuickStart(quick(), quick({ description: "writing" }))).toBe(
      false,
    );
  });

  it("treats the billable flag as part of the identity", () => {
    expect(sameQuickStart(quick(), quick({ billable: true }))).toBe(false);
  });
});

describe("toQuickStart", () => {
  it("keeps only the four fields that decide what is tracked", () => {
    expect(
      toQuickStart({
        description: "Writing",
        projectId: PROJECT,
        taskId: TASK,
        billable: true,
      }),
    ).toEqual({
      description: "Writing",
      projectId: PROJECT,
      taskId: TASK,
      billable: true,
    });
  });
});

describe("quickStartLabel", () => {
  it("uses the description when there is one", () => {
    expect(quickStartLabel(favorite())).toBe("Writing");
  });

  it("falls back to the project, then the task, then a placeholder", () => {
    expect(
      quickStartLabel(
        favorite({ description: "", projectName: "Acme", taskName: "Invoices" }),
      ),
    ).toBe("Acme");
    expect(
      quickStartLabel(favorite({ description: "", taskName: "Invoices" })),
    ).toBe("Invoices");
    expect(quickStartLabel(favorite({ description: "  " }))).toBe(
      "No description",
    );
  });
});

describe("quickStartHint", () => {
  it("reads client then project", () => {
    expect(
      quickStartHint(
        favorite({ projectName: "Website", clientName: "Acme Inc" }),
      ),
    ).toBe("Acme Inc · Website");
  });

  it("marks an archived project without hiding its name", () => {
    expect(
      quickStartHint(favorite({ projectName: "Old", projectArchived: true })),
    ).toBe("Old (archived)");
  });

  it("says a project is deleted rather than printing its id", () => {
    const hint = quickStartHint(
      favorite({ projectId: PROJECT, projectMissing: true }),
    );
    expect(hint).toBe("Project deleted");
    expect(hint).not.toContain(PROJECT);
  });

  it("does not repeat the label when the project already is the label", () => {
    expect(
      quickStartHint(favorite({ description: "", projectName: "Acme" })),
    ).toBeNull();
  });
});

describe("buildQuickStartInput", () => {
  const context = {
    source: "web" as const,
    timeZone: "Europe/Berlin",
    originId: "origin-1",
    now: new Date("2026-08-21T09:15:00.000Z"),
  };

  it("produces the same input shape the offline queue replays", () => {
    expect(
      buildQuickStartInput(
        quick({ projectId: PROJECT, taskId: TASK, billable: true }),
        context,
      ),
    ).toEqual({
      description: "Writing",
      projectId: PROJECT,
      taskId: TASK,
      billable: true,
      start: "2026-08-21T09:15:00.000Z",
      source: "web",
      timeZone: "Europe/Berlin",
      originId: "origin-1",
    });
  });

  it("sends billable explicitly, so a replay cannot re-derive it", () => {
    const input = buildQuickStartInput(quick({ billable: false }), context);
    expect(input.billable).toBe(false);
    expect(Object.keys(input)).toContain("billable");
  });

  it("carries the caller's source, so an entry stays traceable", () => {
    expect(
      buildQuickStartInput(quick(), { ...context, source: "extension" }).source,
    ).toBe("extension");
  });
});

describe("repairQuickStart", () => {
  it("leaves an intact quick start alone", () => {
    const intact = quick({ projectId: PROJECT, taskId: TASK, billable: true });
    expect(repairQuickStart(intact)).toEqual(intact);
  });

  it("drops a project the server would reject, keeping the description", () => {
    expect(
      repairQuickStart({
        ...quick({ projectId: PROJECT, taskId: TASK, billable: true }),
        projectMissing: true,
      }),
    ).toEqual({
      description: "Writing",
      projectId: null,
      taskId: null,
      billable: false,
    });
  });

  it("drops only the task when only the task is gone", () => {
    expect(
      repairQuickStart({
        ...quick({ projectId: PROJECT, taskId: TASK, billable: true }),
        taskMissing: true,
      }),
    ).toEqual({
      description: "Writing",
      projectId: PROJECT,
      taskId: null,
      billable: true,
    });
  });

  it("agrees with isBrokenQuickStart about what needs repairing", () => {
    expect(isBrokenQuickStart({ projectMissing: true, taskMissing: false })).toBe(
      true,
    );
    expect(isBrokenQuickStart({ projectMissing: false, taskMissing: true })).toBe(
      true,
    );
    expect(
      isBrokenQuickStart({ projectMissing: false, taskMissing: false }),
    ).toBe(false);
  });
});

describe("mergeQuickStarts", () => {
  it("puts pins first, in their own order, then recents", () => {
    const items = mergeQuickStarts({
      favorites: [
        favorite({ id: "f1", description: "Pinned A" }),
        favorite({ id: "f2", description: "Pinned B" }),
      ],
      recents: [recent({ description: "Recent A" })],
      limit: 6,
    });
    expect(items.map((item) => item.kind)).toEqual([
      "favorite",
      "favorite",
      "recent",
    ]);
    expect(items.map((item) => item.description)).toEqual([
      "Pinned A",
      "Pinned B",
      "Recent A",
    ]);
  });

  it("drops a recent that is already pinned, rather than showing it twice", () => {
    const items = mergeQuickStarts({
      favorites: [favorite({ description: "Writing", projectId: PROJECT })],
      recents: [
        recent({ description: "Writing", projectId: PROJECT }),
        recent({ description: "Other" }),
      ],
      limit: 6,
    });
    expect(items.map((item) => item.description)).toEqual(["Writing", "Other"]);
  });

  it("still shows a recent that differs from the pin by billable alone", () => {
    const items = mergeQuickStarts({
      favorites: [favorite({ description: "Writing", billable: false })],
      recents: [recent({ description: "Writing", billable: true })],
      limit: 6,
    });
    expect(items).toHaveLength(2);
  });

  it("never lets recents crowd out a pin", () => {
    const items = mergeQuickStarts({
      favorites: [
        favorite({ id: "f1", description: "Pinned A" }),
        favorite({ id: "f2", description: "Pinned B" }),
      ],
      recents: [recent({ description: "Recent A" })],
      limit: 2,
    });
    expect(items.map((item) => item.description)).toEqual([
      "Pinned A",
      "Pinned B",
    ]);
  });

  it("works with no pins at all — day one is recents only", () => {
    const items = mergeQuickStarts({
      favorites: [],
      recents: [recent({ description: "Recent A" })],
      limit: 6,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("recent");
  });

  it("is empty when there is nothing in either tier", () => {
    expect(mergeQuickStarts({ favorites: [], recents: [], limit: 6 })).toEqual(
      [],
    );
  });
});
