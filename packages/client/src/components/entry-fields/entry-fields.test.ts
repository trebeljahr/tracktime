import { describe, expect, it } from "vitest";
import {
  emptyEntryFields,
  entryFieldsFrom,
  sameEntryFields,
  sameTagIds,
  withProject,
  withTags,
  withTask,
  type EntryFields,
} from "@starter/core";

const fields = (overrides: Partial<EntryFields> = {}): EntryFields => ({
  ...emptyEntryFields(),
  ...overrides,
});

describe("withProject", () => {
  it("drops the task, because a task belongs to one project", () => {
    const moved = withProject(
      fields({ projectId: "p1", taskId: "t1" }),
      "p2",
    );
    expect(moved.projectId).toBe("p2");
    expect(moved.taskId).toBeNull();
  });

  it("drops the task when the project is cleared", () => {
    const cleared = withProject(
      fields({ projectId: "p1", taskId: "t1" }),
      null,
    );
    expect(cleared.projectId).toBeNull();
    expect(cleared.taskId).toBeNull();
  });

  // Closing a picker on the value it already had must not be destructive.
  it("keeps the task when the project did not actually change", () => {
    const before = fields({ projectId: "p1", taskId: "t1" });
    expect(withProject(before, "p1")).toBe(before);
  });

  it("leaves the other fields alone", () => {
    const moved = withProject(
      fields({ description: "writing", tagIds: ["a"], billable: true }),
      "p2",
    );
    expect(moved.description).toBe("writing");
    expect(moved.tagIds).toEqual(["a"]);
    expect(moved.billable).toBe(true);
  });
});

describe("withTask", () => {
  it("adopts the project a task created elsewhere belongs to", () => {
    const picked = withTask(fields({ projectId: "p1" }), "t9", "p2");
    expect(picked.taskId).toBe("t9");
    expect(picked.projectId).toBe("p2");
  });

  it("keeps the current project when the task is already scoped to it", () => {
    const picked = withTask(fields({ projectId: "p1" }), "t1");
    expect(picked).toEqual(fields({ projectId: "p1", taskId: "t1" }));
  });

  it("keeps the project when the task is cleared", () => {
    const cleared = withTask(fields({ projectId: "p1", taskId: "t1" }), null);
    expect(cleared.projectId).toBe("p1");
    expect(cleared.taskId).toBeNull();
  });
});

describe("tags", () => {
  it("copies the array rather than aliasing the caller's", () => {
    const source = ["a", "b"];
    const tagged = withTags(emptyEntryFields(), source);
    source.push("c");
    expect(tagged.tagIds).toEqual(["a", "b"]);
  });

  it("compares by value and order", () => {
    expect(sameTagIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameTagIds(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameTagIds(["a"], ["a", "b"])).toBe(false);
    expect(sameTagIds([], [])).toBe(true);
  });
});

describe("entryFieldsFrom", () => {
  it("takes all five off an entry without aliasing its tags", () => {
    const entry = {
      description: "review",
      projectId: "p1",
      taskId: "t1",
      billable: true,
      tagIds: ["a"],
    };
    const taken = entryFieldsFrom(entry);
    expect(taken).toEqual(entry);
    expect(taken.tagIds).not.toBe(entry.tagIds);
  });
});

describe("sameEntryFields", () => {
  it("sees a tag reorder as a change", () => {
    expect(
      sameEntryFields(fields({ tagIds: ["a", "b"] }), fields({ tagIds: ["b", "a"] })),
    ).toBe(false);
  });

  it("sees equal values as equal", () => {
    expect(
      sameEntryFields(
        fields({ description: "x", projectId: "p", tagIds: ["a"] }),
        fields({ description: "x", projectId: "p", tagIds: ["a"] }),
      ),
    ).toBe(true);
  });
});
