// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DateRangePicker, type DateRange } from "./date-range-picker";

afterEach(cleanup);

const Harness = ({
  initial,
  onChange,
}: {
  initial: DateRange;
  onChange: (range: DateRange) => void;
}): React.JSX.Element => {
  const [range, setRange] = React.useState(initial);
  return (
    <DateRangePicker
      value={range}
      onChange={(next) => {
        onChange(next);
        setRange(next);
      }}
      testId="picker"
    />
  );
};

const openPicker = (initial: DateRange) => {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  fireEvent.click(screen.getByTestId("picker"));
  return {
    onChange,
    from: () => screen.getByTestId("picker-from") as HTMLInputElement,
    to: () => screen.getByTestId("picker-to") as HTMLInputElement,
  };
};

const year = { from: "2026-01-01", to: "2026-12-31" } satisfies DateRange;

describe("DateRangePicker custom bounds", () => {
  it("commits an ordered edit to a bound", () => {
    const { onChange, to } = openPicker(year);

    fireEvent.change(to(), { target: { value: "2026-06-30" } });

    expect(onChange).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-06-30",
    });
  });

  it("keeps the other bound while a year is retyped keystroke by keystroke", () => {
    // A native date input fires change per keystroke, so retyping 2026 as 2025
    // walks through 0002, 0020 and 0202 — all earlier than `from`.
    const { onChange, from, to } = openPicker(year);

    for (const partial of ["0002-12-31", "0020-12-31", "0202-12-31"]) {
      fireEvent.change(to(), { target: { value: partial } });
      expect(onChange).not.toHaveBeenCalled();
      expect(from().value).toBe("2026-01-01");
    }

    expect(screen.getByTestId("picker-invalid")).toBeTruthy();

    // Finishing the year is the first thing worth reporting, and `from` is
    // still the one the user set.
    fireEvent.change(to(), { target: { value: "2026-06-30" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-06-30",
    });
  });

  it("shows the half-typed value rather than snapping it back", () => {
    const { to } = openPicker(year);

    fireEvent.change(to(), { target: { value: "0002-12-31" } });

    expect(to().value).toBe("0002-12-31");
  });

  it("does not commit a cleared bound", () => {
    const { onChange, from } = openPicker(year);

    fireEvent.change(from(), { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(from().value).toBe("");
  });

  it("discards an unfinished edit when the popover closes", () => {
    const { onChange, to } = openPicker(year);

    fireEvent.change(to(), { target: { value: "0002-12-31" } });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByTestId("picker"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("picker-to")).toHaveProperty("value", "2026-12-31");
  });
});
