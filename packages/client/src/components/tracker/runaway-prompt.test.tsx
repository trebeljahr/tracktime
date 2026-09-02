// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunawayMark, TimeEntry } from "@starter/shared";

import { RunawayPrompt, type RunawayAnswer } from "./runaway-prompt";

const HOUR = 3600;

/** A Friday evening start, still running on Monday morning: 63 hours. */
const START = "2026-08-28T18:00:00.000Z";
const MONDAY = "2026-08-31T09:00:00.000Z";

const entry = (overrides: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "e1",
  workspaceId: "w1",
  authorId: "u1",
  description: "Wrote tests",
  projectId: null,
  taskId: null,
  billable: false,
  start: START,
  end: null,
  durationSec: 0,
  hourlyRate: null,
  currency: "EUR",
  source: "web",
  timeZone: null,
  runaway: null,
  createdAt: START,
  updatedAt: START,
  ...overrides,
});

const mark = (overrides: Partial<RunawayMark> = {}): RunawayMark => ({
  detectedAt: MONDAY,
  elapsedSec: 63 * HOUR,
  limitSec: 8 * HOUR,
  action: "flagged",
  resolvedAt: null,
  ...overrides,
});

const renderPrompt = (
  entryOverrides: Partial<TimeEntry> = {},
  markOverrides: Partial<RunawayMark> = {},
) => {
  const onAnswer = vi.fn<(answer: RunawayAnswer) => void>();
  render(
    <RunawayPrompt
      entry={entry(entryOverrides)}
      mark={mark(markOverrides)}
      onAnswer={onAnswer}
    />,
  );
  return { onAnswer };
};

afterEach(cleanup);

describe("RunawayPrompt", () => {
  it("leads with how long it ran, not with what was cut", () => {
    renderPrompt();
    expect(screen.getByTestId("runaway-prompt").textContent).toContain("63h");
  });

  it("offers keep, cap and an explicit end for a still-running entry", () => {
    renderPrompt();
    expect(screen.getByTestId("runaway-keep")).toBeTruthy();
    expect(screen.getByTestId("runaway-cap").textContent).toContain("8h");
    expect(screen.getByTestId("runaway-end-at-open")).toBeTruthy();
  });

  it("answers keep without changing anything", () => {
    const { onAnswer } = renderPrompt();
    fireEvent.click(screen.getByTestId("runaway-keep"));
    expect(onAnswer).toHaveBeenCalledWith({ resolution: "keep" });
  });

  it("answers cap with no instant — the server recomputes it", () => {
    const { onAnswer } = renderPrompt();
    fireEvent.click(screen.getByTestId("runaway-cap"));
    expect(onAnswer).toHaveBeenCalledWith({ resolution: "cap" });
  });

  it("offers to put the discarded hours back once a cap has happened", () => {
    // The no-silent-deletion contract, as the user meets it: a capped entry
    // never shows "cap" again, it shows the full span it actually ran.
    const { onAnswer } = renderPrompt(
      { end: "2026-08-29T02:00:00.000Z", durationSec: 8 * HOUR },
      { action: "capped" },
    );

    const restore = screen.getByTestId("runaway-restore");
    expect(restore.textContent).toContain("63h");
    expect(screen.queryByTestId("runaway-cap")).toBeNull();

    fireEvent.click(restore);
    expect(onAnswer).toHaveBeenCalledWith({ resolution: "restore" });
  });

  it("says what already happened when the guard stopped the timer", () => {
    renderPrompt(
      { end: MONDAY, durationSec: 63 * HOUR },
      { action: "stopped" },
    );
    expect(screen.getByTestId("runaway-prompt").textContent).toContain(
      "whole span kept",
    );
  });

  it("hands back the instant typed into the end field", () => {
    const { onAnswer } = renderPrompt();

    fireEvent.click(screen.getByTestId("runaway-end-at-open"));
    const field = screen.getByTestId("runaway-end-at") as HTMLInputElement;
    // datetime-local carries no offset, so this is the viewer's local clock.
    fireEvent.change(field, { target: { value: "2026-08-28T22:30" } });
    fireEvent.click(screen.getByTestId("runaway-end-at-save"));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const answer = onAnswer.mock.calls[0]?.[0] as RunawayAnswer;
    expect(answer.resolution).toBe("end-at");
    expect(answer.end).toBe(new Date("2026-08-28T22:30").toISOString());
  });

  it("prefills the end field with the cap, the likeliest correction", () => {
    renderPrompt();
    fireEvent.click(screen.getByTestId("runaway-end-at-open"));
    const field = screen.getByTestId("runaway-end-at") as HTMLInputElement;
    expect(field.value).toBe(
      // start + 8h, read on the viewer's own clock
      new Date(Date.parse(START) + 8 * HOUR * 1000)
        .toLocaleString("sv-SE")
        .slice(0, 16)
        .replace(" ", "T"),
    );
  });

  it("refuses to answer with an unparseable end", () => {
    const { onAnswer } = renderPrompt();
    fireEvent.click(screen.getByTestId("runaway-end-at-open"));
    fireEvent.change(screen.getByTestId("runaway-end-at"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("runaway-end-at-save"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("carries the original span in the DOM, so nothing is unrecoverable", () => {
    renderPrompt({}, { action: "capped" });
    expect(
      screen.getByTestId("runaway-prompt").dataset.runawayElapsedSec,
    ).toBe(String(63 * HOUR));
  });
});
