import { createId } from "./ids.js";
import type { KeyValueStorage } from "./storage.js";

export type QueuedMutation = {
  id: string;
  op: string;
  payload: unknown;
  createdAt: string;
};

export type OfflineQueue = {
  enqueue(op: string, payload: unknown): Promise<QueuedMutation>;
  list(): Promise<QueuedMutation[]>;
  size(): Promise<number>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Run `runner` over the queue in order, dropping each mutation as it
   * succeeds. Stops at the first failure and leaves that mutation (and
   * everything after it) queued, so ordering is never broken by a retry.
   */
  flush(runner: (mutation: QueuedMutation) => Promise<void>): Promise<FlushResult>;
};

export type FlushResult = {
  flushed: number;
  remaining: number;
  /** The mutation that failed, if the flush stopped early. */
  failed?: QueuedMutation;
  error?: unknown;
};

const isQueuedMutation = (value: unknown): value is QueuedMutation => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.op === "string" &&
    typeof record.createdAt === "string"
  );
};

/**
 * Durable FIFO of mutations made while offline or during a failed request.
 *
 * The queue is the reason start/stop works with the network fully off: the
 * optimistic cache update stands, the mutation waits here, and the flush on
 * reconnect replays it in the order the user performed it.
 */
export const createOfflineQueue = ({
  storage,
  key = "tracktime.offline-queue",
}: {
  storage: KeyValueStorage;
  key?: string;
}): OfflineQueue => {
  const read = async (): Promise<QueuedMutation[]> => {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isQueuedMutation) : [];
    } catch {
      // Corrupt payload — better to drop the queue than to wedge the app.
      return [];
    }
  };

  const write = async (mutations: QueuedMutation[]): Promise<void> => {
    if (mutations.length === 0) {
      await storage.removeItem(key);
      return;
    }
    await storage.setItem(key, JSON.stringify(mutations));
  };

  // Serialize access so two concurrent enqueues can't clobber each other
  // through the read-modify-write window.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return {
    enqueue: (op, payload) =>
      serial(async () => {
        const mutation: QueuedMutation = {
          id: createId(),
          op,
          payload,
          createdAt: new Date().toISOString(),
        };
        const mutations = await read();
        mutations.push(mutation);
        await write(mutations);
        return mutation;
      }),

    list: () => serial(read),

    size: () => serial(async () => (await read()).length),

    remove: (id) =>
      serial(async () => {
        const mutations = await read();
        await write(mutations.filter((m) => m.id !== id));
      }),

    clear: () => serial(async () => write([])),

    flush: (runner) =>
      serial(async () => {
        const mutations = await read();
        let flushed = 0;

        for (const mutation of mutations) {
          try {
            await runner(mutation);
            flushed += 1;
          } catch (error) {
            const remaining = mutations.slice(flushed);
            await write(remaining);
            return {
              flushed,
              remaining: remaining.length,
              failed: mutation,
              error,
            };
          }
        }

        await write([]);
        return { flushed, remaining: 0 };
      }),
  };
};
