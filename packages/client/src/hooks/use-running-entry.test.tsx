// @vitest-environment jsdom
/**
 * `useRunningEntry` may only speak for the server when the server has spoken.
 *
 * The old effect was `setRunning(query.data ?? null)` on every change of
 * `entry`. On a cold offline launch `entries.current` never answers — there is
 * no persisted React Query cache, and React Query pauses the fetch outright
 * while `onlineManager` reports offline — so `data` is `undefined`, `entry` is
 * `null`, and the effect ran on the FIRST render and wiped whatever the
 * running mirror had just seeded. The phone showed no timer, which is the exact
 * failure the mirror exists to prevent.
 *
 * These specs drive the hook against a seeded store and a query that is
 * pending, then errored, then successful.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { TimeEntry } from "@starter/shared";

const queryState = {
  data: undefined as TimeEntry | null | undefined,
  isSuccess: false,
  isError: false,
  isPending: true,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    entries: { current: { useQuery: () => queryState } },
  },
}));

const writeRunningMirror = vi.fn(
  async (_entry: TimeEntry | null): Promise<void> => undefined,
);
vi.mock("@/lib/running-mirror", () => ({
  writeRunningMirror: (entry: TimeEntry | null) => writeRunningMirror(entry),
}));

const { timerStore, useRunningEntry } = await import("@/hooks/use-sync");

const seeded: TimeEntry = {
  id: "e1",
  workspaceId: "w1",
  authorId: "u1",
  description: "Seeded from the mirror",
  projectId: null,
  taskId: null,
  billable: false,
  start: new Date(Date.now() - 60_000).toISOString(),
  end: null,
  durationSec: 0,
  hourlyRate: null,
  currency: "EUR",
} as TimeEntry;

let observed: { entry: TimeEntry | null; elapsedSec: number } | null = null;

function Probe(): null {
  observed = useRunningEntry();
  return null;
}

beforeEach(() => {
  timerStore.getState().clear();
  observed = null;
  queryState.data = undefined;
  queryState.isSuccess = false;
  queryState.isError = false;
  queryState.isPending = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useRunningEntry", () => {
  it("keeps a seeded entry while the query is still pending", async () => {
    timerStore.getState().setRunning(seeded);

    render(<Probe />);

    await waitFor(() => expect(observed).not.toBeNull());
    expect(timerStore.getState().running).toEqual(seeded);
    expect(observed?.entry).toEqual(seeded);
    expect(observed?.elapsedSec).toBeGreaterThanOrEqual(60);
    // Nothing was mirrored: there is nothing authoritative to mirror yet.
    expect(writeRunningMirror).not.toHaveBeenCalled();
  });

  it("keeps a seeded entry when the query fails", async () => {
    timerStore.getState().setRunning(seeded);
    queryState.isPending = false;
    queryState.isError = true;

    render(<Probe />);

    await waitFor(() => expect(observed).not.toBeNull());
    expect(timerStore.getState().running).toEqual(seeded);
    expect(writeRunningMirror).not.toHaveBeenCalled();
  });

  it("adopts the server's answer once it arrives, and mirrors it", async () => {
    timerStore.getState().setRunning(seeded);
    const fromServer: TimeEntry = { ...seeded, id: "e2", description: "Server" };
    queryState.isPending = false;
    queryState.isSuccess = true;
    queryState.data = fromServer;

    render(<Probe />);

    await waitFor(() =>
      expect(timerStore.getState().running).toEqual(fromServer),
    );
    expect(writeRunningMirror).toHaveBeenCalledWith(fromServer);
  });

  it("clears a seeded entry when the server says nothing is running", async () => {
    timerStore.getState().setRunning(seeded);
    queryState.isPending = false;
    queryState.isSuccess = true;
    queryState.data = null;

    render(<Probe />);

    await waitFor(() => expect(timerStore.getState().running).toBeNull());
    // Clearing the mirror too, or the next cold launch resurrects it.
    expect(writeRunningMirror).toHaveBeenCalledWith(null);
  });
});
