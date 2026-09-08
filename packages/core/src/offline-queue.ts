import { createId } from "./ids.js";
import type { KeyValueStorage } from "./storage.js";

export type QueuedMutation = {
  id: string;
  op: string;
  payload: unknown;
  createdAt: string;
  /**
   * The account this row was queued under.
   *
   * Optional, and it has to stay optional: rows written by a build that
   * predates ownership stamping decode without it, and one of those rows is
   * time the user tracked that no server has ever seen. `undefined` means
   * "nobody has claimed this yet" — see `adoptUnowned`.
   *
   * A raw user id rather than a hash of one. The check this field exists for
   * is an equality test that decides whose workspace a start is written into,
   * and a short non-cryptographic hash would make that test probabilistic:
   * one collision reintroduces exactly the cross-account replay the stamp is
   * here to prevent. The value never leaves the device, and it sits beside a
   * session token in the same store.
   */
  owner?: string;
};

export type OfflineQueue = {
  enqueue(op: string, payload: unknown, owner?: string): Promise<QueuedMutation>;
  list(): Promise<QueuedMutation[]>;
  size(): Promise<number>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Stamp every row that carries no owner with `owner`, and report how many
   * were claimed. The first account to sign in after an upgrade adopts the
   * rows the old build left behind — they are almost certainly its own, and
   * the alternative to claiming them is either stranding them forever or
   * letting the account after next replay them.
   */
  adoptUnowned(owner: string): Promise<number>;
  /**
   * Run `runner` over the queue in order, dropping each mutation as it
   * succeeds. Stops at the first failure and leaves that mutation (and
   * everything after it) queued, so ordering is never broken by a retry.
   *
   * `options.filter` decides which rows are the runner's business. A row it
   * rejects is neither run nor dropped: it keeps its place in the queue and
   * is counted in `skipped`. That is what lets one device hold another
   * account's queued work without either replaying it or destroying it.
   */
  flush(
    runner: (mutation: QueuedMutation) => Promise<void>,
    options?: FlushOptions
  ): Promise<FlushResult>;
};

export type FlushOptions = {
  /** Rows this predicate rejects stay queued, untouched and unreplayed. */
  filter?: (mutation: QueuedMutation) => boolean;
};

export type FlushResult = {
  flushed: number;
  remaining: number;
  /** Rows the filter held back. They are part of `remaining`. */
  skipped: number;
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
 * An `owner` that is not a string is no owner at all. Anything else would let
 * a corrupt or hand-edited row compare equal to nothing and sit in the queue
 * forever, or — worse — compare equal to whatever `undefined` is treated as.
 */
const normalize = (mutation: QueuedMutation): QueuedMutation =>
  typeof mutation.owner === "string" && mutation.owner.length > 0
    ? mutation
    : { ...mutation, owner: undefined };

/**
 * True when `owner` may replay `mutation`.
 *
 * Unowned rows are replayable by whoever is signed in, which is the same
 * decision `adoptUnowned` makes eagerly — the two must agree, or a row could
 * be adopted by one account and replayed by another. Nobody replays anything
 * while signed out.
 */
export const isReplayableBy = (
  mutation: Pick<QueuedMutation, "owner">,
  owner: string | null
): boolean => {
  if (owner === null) return false;
  return mutation.owner === undefined || mutation.owner === owner;
};

/**
 * True when `mutation` demonstrably belongs to somebody else.
 *
 * The negation of `isReplayableBy` in every case but one: an unowned row is
 * not foreign to a caller who does not know who it is yet. Replaying such a
 * row is a decision that must wait for an account (`isReplayableBy` refuses
 * it); merely reading or cancelling it is not.
 */
export const isForeignTo = (
  mutation: Pick<QueuedMutation, "owner">,
  owner: string | null
): boolean => mutation.owner !== undefined && mutation.owner !== owner;

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
      return Array.isArray(parsed)
        ? parsed.filter(isQueuedMutation).map(normalize)
        : [];
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
    enqueue: (op, payload, owner) =>
      serial(async () => {
        const mutation: QueuedMutation = {
          id: createId(),
          op,
          payload,
          createdAt: new Date().toISOString(),
          owner,
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

    adoptUnowned: (owner) =>
      serial(async () => {
        const mutations = await read();
        const unowned = mutations.filter((m) => m.owner === undefined);
        if (unowned.length === 0) return 0;
        await write(
          mutations.map((m) => (m.owner === undefined ? { ...m, owner } : m))
        );
        return unowned.length;
      }),

    flush: (runner, options) =>
      serial(async () => {
        const mutations = await read();
        const wanted = options?.filter ?? (() => true);
        // Rows the filter held back, in order, so they can be written back
        // ahead of whatever is still unprocessed when a flush stops early.
        const kept: QueuedMutation[] = [];
        let flushed = 0;

        for (const [index, mutation] of mutations.entries()) {
          if (!wanted(mutation)) {
            kept.push(mutation);
            continue;
          }
          try {
            await runner(mutation);
            flushed += 1;
          } catch (error) {
            const remaining = [...kept, ...mutations.slice(index)];
            await write(remaining);
            return {
              flushed,
              skipped: kept.length,
              remaining: remaining.length,
              failed: mutation,
              error,
            };
          }
        }

        await write(kept);
        return { flushed, skipped: kept.length, remaining: kept.length };
      }),
  };
};
