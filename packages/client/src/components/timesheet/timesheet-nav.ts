/**
 * Keyboard traversal for the timesheet grid.
 *
 * A grid that cannot be driven from the keyboard is not a timesheet, it is a
 * form with a lot of boxes. The movement itself is pure so it can be tested
 * without a DOM: the component only turns a position into a focus() call.
 *
 * Arrow keys do NOT wrap at the edges. Wrapping is how a fast typist ends up
 * three rows away from where they think they are; Tab is already the "keep
 * going, wherever that leads" key.
 */

export type CellPosition = { row: number; col: number };

export type GridSize = { rows: number; cols: number };

/** The keys the grid handles itself. Everything else belongs to the input. */
export const TIMESHEET_NAV_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Home",
  "End",
] as const;

export type TimesheetNavKey = (typeof TIMESHEET_NAV_KEYS)[number];

export const isNavKey = (key: string): key is TimesheetNavKey =>
  (TIMESHEET_NAV_KEYS as readonly string[]).includes(key);

const clampedMove = (
  from: CellPosition,
  deltaRow: number,
  deltaCol: number,
  size: GridSize
): CellPosition | null => {
  const row = from.row + deltaRow;
  const col = from.col + deltaCol;
  if (row < 0 || row >= size.rows) return null;
  if (col < 0 || col >= size.cols) return null;
  return { row, col };
};

/**
 * Where a key moves focus from `from`, or null when it stays put.
 *
 * Enter moves DOWN rather than right: a timesheet is filled a row at a time
 * horizontally with Tab, and a column at a time vertically when catching up on
 * one project across a week. Down is the spreadsheet convention for Enter and
 * the one people already have in their fingers.
 */
export const nextCellPosition = (
  from: CellPosition,
  key: TimesheetNavKey,
  size: GridSize
): CellPosition | null => {
  if (size.rows <= 0 || size.cols <= 0) return null;

  switch (key) {
    case "ArrowUp":
      return clampedMove(from, -1, 0, size);
    case "ArrowDown":
    case "Enter":
      return clampedMove(from, 1, 0, size);
    case "ArrowLeft":
      return clampedMove(from, 0, -1, size);
    case "ArrowRight":
      return clampedMove(from, 0, 1, size);
    case "Home":
      return from.col === 0 ? null : { row: from.row, col: 0 };
    case "End":
      return from.col === size.cols - 1
        ? null
        : { row: from.row, col: size.cols - 1 };
  }
};

/** Key for the focus registry — one entry per cell. */
export const cellKey = (position: CellPosition): string =>
  `${position.row}:${position.col}`;
