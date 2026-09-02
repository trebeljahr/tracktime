/**
 * The web client's half of the offline replay: how a decoded queue row is
 * turned back into a real API call, and what has to be repaired once it lands.
 *
 * It sits outside `use-offline-queue` because the repair is the part worth
 * testing and none of it needs React — the hook only supplies the tRPC
 * bindings and the tab's idle watcher.
 */
import {
  noteReplayedServerId,
  type IdleWatcher,
  type OfflineMutation,
  type OfflineOp,
  type OfflinePayloadMap,
} from "@starter/core";

/** One call per queued op. The hook binds these to its tRPC mutations. */
export type OfflineReplayMutators = {
  [K in OfflineOp]: (input: OfflinePayloadMap[K]) => Promise<unknown>;
};

/**
 * Replay one queued mutation against the server.
 *
 * Rejections are the caller's problem — `flush` classifies them into "still
 * offline, keep the queue in order" and "the server refused it, drop it" — so
 * nothing is caught here.
 */
export const replayOfflineMutation = async (
  mutators: OfflineReplayMutators,
  watcher: Pick<IdleWatcher, "noteServerId">,
  mutation: OfflineMutation
): Promise<void> => {
  switch (mutation.op) {
    case "entries.start": {
      // The result is not discarded, unlike every other op below: a start made
      // while offline was claimed on the watcher against its temp id, and the
      // real id only exists now. Without the rename the ownership check in
      // `observe` fails against the named entry and idle detection silently
      // never fires again for it.
      const entry = await mutators["entries.start"](mutation.input);
      noteReplayedServerId(watcher, mutation, entry);
      return;
    }
    case "entries.stop":
      await mutators["entries.stop"](mutation.input);
      return;
    case "entries.create":
      await mutators["entries.create"](mutation.input);
      return;
    case "entries.update":
      await mutators["entries.update"](mutation.input);
      return;
    case "entries.remove":
      await mutators["entries.remove"](mutation.input);
      return;
    case "entries.discard":
      await mutators["entries.discard"](mutation.input);
      return;
  }
};
