// The retry schedule and the give-up point.
//
// Two failure modes, both silent. Off by one in the wrong direction and a
// delivery retries forever against a host that no longer exists; off by one
// in the other and a subscription is switched off after a single blip, with
// the owner finding out weeks later that their integration stopped.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  nextAttemptAt,
  retryDelayMs,
  shouldAutoDisable,
} from "../services/webhooks/backoff.js";
import { WEBHOOK_AUTO_DISABLE_AFTER } from "../models/WebhookSubscription.js";

describe("webhook retry schedule", () => {
  it("is the documented 0s / 30s / 2m / 10m / 1h / 6h", () => {
    // Pinned as literals rather than derived, so a "tidy-up" of the constant
    // has to come past this test and say what it is changing.
    assert.deepEqual(
      [...WEBHOOK_BACKOFF_MS],
      [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000],
    );
    assert.equal(WEBHOOK_MAX_ATTEMPTS, 6);
  });

  it("schedules each attempt from the number already made", () => {
    assert.equal(retryDelayMs(1), 30_000);
    assert.equal(retryDelayMs(2), 120_000);
    assert.equal(retryDelayMs(3), 600_000);
    assert.equal(retryDelayMs(4), 3_600_000);
    assert.equal(retryDelayMs(5), 21_600_000);
  });

  it("gives up after the sixth attempt and not before", () => {
    // `null` is the ONE terminal signal. A fifth failure must still be
    // retryable, and a sixth must not be — this is the off-by-one.
    assert.notEqual(retryDelayMs(5), null);
    assert.equal(retryDelayMs(6), null);
    assert.equal(retryDelayMs(7), null);
    assert.equal(retryDelayMs(99), null);
  });

  it("treats a not-yet-attempted delivery as due immediately", () => {
    assert.equal(retryDelayMs(0), 0);
  });

  it("turns the delay into an absolute instant", () => {
    const from = new Date("2026-09-07T10:00:00.000Z");
    const at = nextAttemptAt(1, from);
    assert.ok(at);
    assert.equal(at.toISOString(), "2026-09-07T10:00:30.000Z");
    assert.equal(nextAttemptAt(WEBHOOK_MAX_ATTEMPTS, from), null);
  });

  it("spans hours, not seconds, before giving up", () => {
    // The auto-disable threshold is only defensible because one dead delivery
    // already costs the better part of a day.
    const total = WEBHOOK_BACKOFF_MS.reduce<number>((sum, ms) => sum + ms, 0);
    assert.ok(total > 7 * 60 * 60 * 1000, `total was ${total}ms`);
  });
});

describe("webhook auto-disable", () => {
  it("fires at fifteen consecutive failed deliveries, not before", () => {
    assert.equal(WEBHOOK_AUTO_DISABLE_AFTER, 15);
    assert.equal(shouldAutoDisable(0), false);
    assert.equal(shouldAutoDisable(1), false);
    assert.equal(shouldAutoDisable(14), false);
    assert.equal(shouldAutoDisable(15), true);
    assert.equal(shouldAutoDisable(16), true);
  });

  it("counts deliveries, so one bad afternoon cannot reach it", () => {
    // Deliberately restating the unit: counting ATTEMPTS instead would hit
    // fifteen inside three failed deliveries — under half a day of downtime.
    const attemptsPerDelivery = WEBHOOK_MAX_ATTEMPTS;
    assert.ok(WEBHOOK_AUTO_DISABLE_AFTER > attemptsPerDelivery);
  });
});
