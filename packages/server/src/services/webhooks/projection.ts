// What one subscription is allowed to be told.
//
// A webhook is a STANDING grant: it was authorised once and then keeps
// delivering for months. So "may this person see this?" cannot be answered at
// subscribe time and frozen — it is re-asked here, at send time, against the
// subscription owner's live membership. A member demoted this morning stops
// receiving colleagues' entries this afternoon.
//
// The envelope stored on the delivery row is deliberately UNPROJECTED (see
// models/WebhookDelivery.ts). This function is the only thing standing between
// it and the wire, which is why it is pure, exported, and unit-tested with the
// negative cases spelled out.
//
// Subpath imports from @starter/shared, not the bare specifier: a bare named
// import throws under tsx, and a module that cannot be loaded by node:test is
// a module whose money-stripping nobody checks. See ws-sync.test.ts:5-8.
import type { Visibility } from "@starter/shared/types";
import type { WebhookEnvelope } from "@starter/shared/webhooks";
import {
  canSeeEntry,
  projectEntryForVisibility,
} from "@starter/shared/visibility";

/**
 * The envelope as this subscription's owner may see it, or `null` when they
 * may not see the event at all (the caller records `skipped_visibility`).
 *
 * Three rules, each of which leaks quietly if broken:
 *
 *  - No `canViewOthersTime` → a colleague's entry is not delivered AT ALL.
 *    Not stripped, not summarised: withheld. The existence of the entry is
 *    itself the thing that flag hides.
 *  - No `canViewOthersMoney` → a colleague's entry is delivered without its
 *    `hourlyRate`. `projectEntryForVisibility` owns that rule so the REST
 *    responses and this stream cannot disagree about it.
 *  - `invoice.*` is money end to end — a total, a set of line amounts, a rate
 *    per line. There is no non-money residue worth sending, so the whole
 *    event is withheld from an owner without `canViewOthersMoney` rather than
 *    delivered with holes punched in it.
 *
 * The switch is exhaustive with NO default arm: a new `WebhookEventData` kind
 * must fail to compile here, because the alternative is a new event shape
 * defaulting into "deliverable" and shipping somebody else's rates.
 */
export function projectWebhookEnvelope(
  envelope: WebhookEnvelope,
  visibility: Visibility,
): WebhookEnvelope | null {
  const data = envelope.data;

  switch (data.kind) {
    case "entry": {
      const entry = projectEntryForVisibility(data.entry, visibility);
      if (!entry) return null;
      return { ...envelope, data: { kind: "entry", entry } };
    }
    case "entry-deleted": {
      // The row is gone, so `authorId` on the payload is the only thing left
      // to ask the time question about — which is exactly why the envelope
      // carries it and the id-only SyncEvent counterpart does not.
      if (!canSeeEntry(visibility, data.authorId)) return null;
      return envelope;
    }
    case "invoice":
    case "invoice-status": {
      if (!visibility.canViewOthersMoney) return null;
      return envelope;
    }
  }

  // No `default:` arm, deliberately. A default would give a newly added event
  // kind a behaviour by accident; this assignment gives it a type error. `data`
  // is `never` here only while every arm above returns.
  const unreachable: never = data;
  return unreachable;
}
