/**
 * The queue outlives a sign-out on purpose: `isAuthError` stops the flush and
 * KEEPS the rows, because they are time the server has never seen. That makes
 * the queue a shared surface between whoever used this device last and whoever
 * is using it now — so every row records the account that queued it, and a
 * flush replays only the rows belonging to the account currently signed in.
 *
 * These are the client-side half of that. The pure queue mechanics live in
 * core-offline-queue.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetOfflineQueueForTests,
  __resetOfflineQueueOwnerForTests,
  enqueueOffline,
  flushOfflineQueue,
  getForeignCount,
  getOfflineQueue,
  getOfflineQueueOwner,
  getPendingCount,
  refreshPendingCount,
  setOfflineQueueOwner,
  type OfflineMutation,
  type OfflineStartInput,
} from "./offline";

const startInput = (description: string): OfflineStartInput => ({
  description,
  projectId: null,
  taskId: null,
  billable: true,
  start: "2026-08-21T09:00:00.000Z",
  source: "web",
  timeZone: "Europe/Berlin",
  originId: "tab-1",
});

/** Replay everything the current account is allowed to replay. */
const replay = async (): Promise<string[]> => {
  const seen: string[] = [];
  await flushOfflineQueue(async (mutation: OfflineMutation) => {
    seen.push((mutation.input as { description?: string }).description ?? mutation.op);
  });
  return seen;
};

describe("queue ownership", () => {
  beforeEach(() => {
    // A fresh in-memory queue per test — under the node environment there is
    // no window, so `resolveStorage()` hands back `memoryStorage()`.
    __resetOfflineQueueForTests();
    __resetOfflineQueueOwnerForTests();
  });

  it("stamps queued rows with the signed-in account", async () => {
    await setOfflineQueueOwner("user-a");
    expect(getOfflineQueueOwner()).toBe("user-a");

    await enqueueOffline("entries.start", startInput("A's work"), "temp-1");

    const rows = await getOfflineQueue().list();
    expect(rows.map((row) => row.owner)).toEqual(["user-a"]);
  });

  it("does not replay one account's rows under the next account", async () => {
    await setOfflineQueueOwner("user-a");
    await enqueueOffline("entries.start", startInput("A's work"), "temp-1");
    await enqueueOffline("entries.stop", {
      end: "2026-08-21T10:00:00.000Z",
      originId: "tab-1",
    });

    // A signs out, B signs in on the same device.
    await setOfflineQueueOwner(null);
    await setOfflineQueueOwner("user-b");

    expect(await replay()).toEqual([]);

    // Nothing was dropped — that is somebody's tracked time — and B is told
    // the device is holding it rather than shown a silently stuck counter.
    expect(await getOfflineQueue().size()).toBe(2);
    expect(getPendingCount()).toBe(0);
    expect(getForeignCount()).toBe(2);
  });

  it("replays an account's own rows when it signs back in", async () => {
    await setOfflineQueueOwner("user-a");
    await enqueueOffline("entries.start", startInput("A's work"), "temp-1");

    await setOfflineQueueOwner(null);
    await setOfflineQueueOwner("user-b");
    expect(await replay()).toEqual([]);

    await setOfflineQueueOwner("user-a");
    expect(getPendingCount()).toBe(1);
    expect(getForeignCount()).toBe(0);

    expect(await replay()).toEqual(["A's work"]);
    expect(await getOfflineQueue().size()).toBe(0);
  });

  it("keeps each account's rows apart in one queue", async () => {
    await setOfflineQueueOwner("user-a");
    await enqueueOffline("entries.start", startInput("A one"), "temp-a1");
    await setOfflineQueueOwner("user-b");
    await enqueueOffline("entries.start", startInput("B one"), "temp-b1");
    await setOfflineQueueOwner("user-a");
    await enqueueOffline("entries.start", startInput("A two"), "temp-a2");

    expect(await replay()).toEqual(["A one", "A two"]);

    await setOfflineQueueOwner("user-b");
    expect(getPendingCount()).toBe(1);
    expect(await replay()).toEqual(["B one"]);
  });

  it("lets the first account to sign in adopt rows queued before stamping", async () => {
    // No owner resolved yet — the shape a build predating ownership wrote,
    // and the shape a mutation queued mid-session-resolution still writes.
    await enqueueOffline("entries.start", startInput("legacy"), "temp-1");
    expect((await getOfflineQueue().list())[0].owner).toBeUndefined();

    // Unknown owner is not the same as "somebody else queued this": with no
    // account resolved, nothing is accused of being foreign.
    expect(await refreshPendingCount()).toBe(1);
    expect(getForeignCount()).toBe(0);

    await setOfflineQueueOwner("user-a");
    expect((await getOfflineQueue().list())[0].owner).toBe("user-a");

    // And from then on it is A's, so B cannot replay it.
    await setOfflineQueueOwner("user-b");
    expect(await replay()).toEqual([]);
    expect(getForeignCount()).toBe(1);

    await setOfflineQueueOwner("user-a");
    expect(await replay()).toEqual(["legacy"]);
  });

  it("replays nothing at all while no account is resolved", async () => {
    await setOfflineQueueOwner("user-a");
    await enqueueOffline("entries.start", startInput("A's work"), "temp-1");
    await setOfflineQueueOwner(null);

    expect(await replay()).toEqual([]);
    expect(await getOfflineQueue().size()).toBe(1);
  });

  it("reports how many legacy rows an account adopted", async () => {
    await enqueueOffline("entries.start", startInput("one"), "temp-1");
    await enqueueOffline("entries.start", startInput("two"), "temp-2");

    expect(await setOfflineQueueOwner("user-a")).toBe(2);
    // Nothing left to adopt, so a later switch claims nothing.
    expect(await setOfflineQueueOwner("user-b")).toBe(0);
  });
});
