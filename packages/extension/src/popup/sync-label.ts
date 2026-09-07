/**
 * What the popup says about sync, in one place.
 *
 * Lifted out of `tracker-screen.tsx` because the tracker is no longer the only
 * screen that reports it: a pushed screen shows the same verdict as a bare dot
 * in its header, and a second implementation of "when is this Offline" would
 * be a second place for the two to disagree about the same snapshot.
 */
import type { SyncStatus } from "@starter/core";

export type SyncLabel = {
  label: string;
  /** Suffix of the `.status__dot--*` modifier. */
  tone: string;
  /** The sentence behind the dot, used as its `title` where there is no room for the label. */
  title: string;
};

/**
 * "Offline" is reserved for the one case where it is true: the server did not
 * answer. A socket that is down while HTTP is fine is a real but much smaller
 * problem — other devices' changes arrive on the next poll instead of
 * instantly — and labelling it "Offline" while the toolbar was signed in and
 * saving happily was simply wrong, and unnerving with it.
 *
 * Queued work outranks both, because it is the only state where something the
 * user did has not reached the server yet.
 */
export const describeSync = (
  status: SyncStatus,
  serverReachable: boolean,
  pending: number,
): SyncLabel => {
  if (!serverReachable) {
    return {
      label: pending > 0 ? `Offline · ${pending} queued` : "Offline",
      tone: "closed",
      title:
        pending > 0
          ? `The server is not answering. ${pending} change${pending === 1 ? "" : "s"} will be sent when it does.`
          : "The server is not answering. Timers still start and stop, and are sent when it comes back.",
    };
  }
  if (pending > 0) {
    return {
      label: `${pending} queued`,
      tone: "pending",
      title: `${pending} change${pending === 1 ? "" : "s"} still to send.`,
    };
  }
  if (status === "open") {
    return {
      label: "Synced",
      tone: "open",
      title: "Live updates from your other devices are connected.",
    };
  }
  if (status === "connecting") {
    return {
      label: "Connecting…",
      tone: "connecting",
      title: "Connecting to live updates.",
    };
  }
  return {
    label: "Polling",
    tone: "polling",
    title:
      "Live updates are unavailable, so changes made elsewhere show up on a short delay. Everything you do here is saved normally.",
  };
};
