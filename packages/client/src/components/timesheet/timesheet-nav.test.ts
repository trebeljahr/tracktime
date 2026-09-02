import { describe, expect, it } from "vitest";

import { isNavKey, nextCellPosition } from "./timesheet-nav";

const WEEK = { rows: 3, cols: 7 };

describe("nextCellPosition", () => {
  it("moves one cell in the arrow's direction", () => {
    const from = { row: 1, col: 3 };
    expect(nextCellPosition(from, "ArrowUp", WEEK)).toEqual({ row: 0, col: 3 });
    expect(nextCellPosition(from, "ArrowDown", WEEK)).toEqual({ row: 2, col: 3 });
    expect(nextCellPosition(from, "ArrowLeft", WEEK)).toEqual({ row: 1, col: 2 });
    expect(nextCellPosition(from, "ArrowRight", WEEK)).toEqual({ row: 1, col: 4 });
  });

  it("stops at the edges instead of wrapping", () => {
    expect(nextCellPosition({ row: 0, col: 0 }, "ArrowUp", WEEK)).toBeNull();
    expect(nextCellPosition({ row: 0, col: 0 }, "ArrowLeft", WEEK)).toBeNull();
    expect(nextCellPosition({ row: 2, col: 6 }, "ArrowDown", WEEK)).toBeNull();
    expect(nextCellPosition({ row: 2, col: 6 }, "ArrowRight", WEEK)).toBeNull();
  });

  it("sends Enter down the column, the spreadsheet convention", () => {
    expect(nextCellPosition({ row: 0, col: 4 }, "Enter", WEEK)).toEqual({
      row: 1,
      col: 4,
    });
    expect(nextCellPosition({ row: 2, col: 4 }, "Enter", WEEK)).toBeNull();
  });

  it("jumps to the first and last day of the row", () => {
    expect(nextCellPosition({ row: 1, col: 3 }, "Home", WEEK)).toEqual({
      row: 1,
      col: 0,
    });
    expect(nextCellPosition({ row: 1, col: 3 }, "End", WEEK)).toEqual({
      row: 1,
      col: 6,
    });
    expect(nextCellPosition({ row: 1, col: 0 }, "Home", WEEK)).toBeNull();
    expect(nextCellPosition({ row: 1, col: 6 }, "End", WEEK)).toBeNull();
  });

  it("has nowhere to go in an empty grid", () => {
    expect(
      nextCellPosition({ row: 0, col: 0 }, "ArrowDown", { rows: 0, cols: 0 })
    ).toBeNull();
  });

  it("recognises only the keys the grid handles", () => {
    expect(isNavKey("ArrowUp")).toBe(true);
    expect(isNavKey("Enter")).toBe(true);
    expect(isNavKey("Escape")).toBe(false);
    expect(isNavKey("a")).toBe(false);
  });
});
