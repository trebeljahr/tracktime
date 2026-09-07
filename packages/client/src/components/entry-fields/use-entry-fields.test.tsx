// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { withProject, withTags, type EntryFields } from "@starter/core";

import {
  useWriteThroughEntryFields,
  type WriteThroughEntry,
} from "./use-entry-fields";

afterEach(cleanup);

const entry = (
  overrides: Partial<WriteThroughEntry> = {},
): WriteThroughEntry => ({
  id: "e1",
  description: "Writing docs",
  projectId: "p1",
  taskId: "t1",
  billable: true,
  tagIds: ["tag-1"],
  ...overrides,
});

const setup = (initial = entry()) => {
  const commit = vi.fn();
  const view = renderHook(
    ({ current }: { current: WriteThroughEntry }) =>
      useWriteThroughEntryFields(current, commit),
    { initialProps: { current: initial } },
  );
  return { commit, view };
};

describe("useWriteThroughEntryFields", () => {
  it("starts from the entry", () => {
    const { view } = setup();
    expect(view.result.current.fields).toEqual({
      description: "Writing docs",
      projectId: "p1",
      taskId: "t1",
      billable: true,
      tagIds: ["tag-1"],
    });
  });

  // The whole reason project and task are one control: the server refuses the
  // pair when they disagree, so both have to travel in one write.
  it("commits the cleared task together with a project change", () => {
    const { commit, view } = setup();
    const next = withProject(view.result.current.fields, "p2");

    act(() => {
      view.result.current.onChange(next, {
        projectId: next.projectId,
        taskId: next.taskId,
      });
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ projectId: "p2", taskId: null });
  });

  it("commits a tag change immediately", () => {
    const { commit, view } = setup();
    const next = withTags(view.result.current.fields, ["tag-2"]);

    act(() => {
      view.result.current.onChange(next, { tagIds: next.tagIds });
    });

    expect(commit).toHaveBeenCalledWith({ tagIds: ["tag-2"] });
  });

  // A write per keystroke would put a mutation — and an undo step — behind
  // every letter typed.
  it("does not write while the description is being typed", () => {
    const { commit, view } = setup();

    act(() => {
      const next: EntryFields = {
        ...view.result.current.fields,
        description: "Writing d",
      };
      view.result.current.onChange(next, { description: next.description });
    });

    expect(commit).not.toHaveBeenCalled();
    expect(view.result.current.fields.description).toBe("Writing d");
  });

  it("writes the description on commit", () => {
    const { commit, view } = setup();

    act(() => {
      const next = { ...view.result.current.fields, description: "Reviewing" };
      view.result.current.onChange(next, { description: next.description });
    });
    act(() => {
      view.result.current.commitDescription();
    });

    expect(commit).toHaveBeenCalledWith({ description: "Reviewing" });
  });

  it("writes nothing when the description was not touched", () => {
    const { commit, view } = setup();
    act(() => {
      view.result.current.commitDescription();
    });
    expect(commit).not.toHaveBeenCalled();
  });

  // An edit made on another device, or a drag on this one, has to be adopted
  // rather than overwritten by whatever the pickers last painted.
  it("adopts an entry that changed underneath it", () => {
    const { view } = setup();

    view.rerender({
      current: entry({ description: "Renamed elsewhere", tagIds: ["tag-9"] }),
    });

    expect(view.result.current.fields.description).toBe("Renamed elsewhere");
    expect(view.result.current.fields.tagIds).toEqual(["tag-9"]);
  });
});
