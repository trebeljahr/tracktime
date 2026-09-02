import assert from "node:assert/strict";
import test from "node:test";
// Subpath imports on purpose — a bare named import from "@starter/shared"
// throws under tsx. See the note at the top of duration.test.ts.
import {
  DEFAULT_MAX_DURATION_SETTINGS,
  evaluateRunaway,
  isRunawayGuardOn,
  resolvedEndMs,
  runawayLimitSec,
  RUNAWAY_BEHAVIORS,
  runawayBehaviorDescription,
  runawayBehaviorLabel,
  type RunawayDecision,
} from "@starter/shared/runaway";
import type {
  MaxDurationSettings,
  RunawayMark,
} from "@starter/shared/types";

const HOUR_MS = 3600 * 1000;

/**
 * The clock is a parameter, never `Date.now()`. Every case below is a weekend
 * or an overnight expressed as arithmetic, so the suite runs in milliseconds
 * and none of it is timing-dependent.
 */
const START = Date.parse("2026-08-28T18:00:00.000Z"); // a Friday evening
const MONDAY = Date.parse("2026-08-31T09:00:00.000Z"); // 63 hours later

const settings = (
  overrides: Partial<MaxDurationSettings> = {},
): MaxDurationSettings => ({
  maxHours: 8,
  behavior: "ask",
  ...overrides,
});

const mark = (overrides: Partial<RunawayMark> = {}): RunawayMark => ({
  detectedAt: "2026-08-31T09:00:00.000Z",
  elapsedSec: 63 * 3600,
  limitSec: 8 * 3600,
  action: "flagged",
  resolvedAt: null,
  ...overrides,
});

// ── the setting itself ───────────────────────────────────────────────

test("0, null and undefined all mean the guard is off", () => {
  assert.equal(isRunawayGuardOn(settings({ maxHours: 0 })), false);
  assert.equal(isRunawayGuardOn(null), false);
  assert.equal(isRunawayGuardOn(undefined), false);
  assert.equal(isRunawayGuardOn(settings({ maxHours: 1 })), true);

  assert.equal(runawayLimitSec(settings({ maxHours: 0 })), 0);
  assert.equal(runawayLimitSec(settings({ maxHours: 12 })), 12 * 3600);
  assert.equal(runawayLimitSec(null), 0);
});

test("the shipped default is on, and asks rather than acting", () => {
  assert.ok(DEFAULT_MAX_DURATION_SETTINGS.maxHours > 0);
  assert.equal(DEFAULT_MAX_DURATION_SETTINGS.behavior, "ask");
});

test("every behaviour has a label and a description", () => {
  for (const behavior of RUNAWAY_BEHAVIORS) {
    assert.ok(runawayBehaviorLabel(behavior).length > 0);
    assert.ok(runawayBehaviorDescription(behavior).length > 0);
  }
});

// ── a running entry older than the cap, under each behaviour ─────────

test("ask flags the weekend timer and leaves it running", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "ask" }),
  });

  assert.equal(decision.kind, "flag");
  assert.equal(decision.kind === "flag" && decision.mark.action, "flagged");
  assert.equal(
    decision.kind === "flag" && decision.mark.elapsedSec,
    63 * 3600,
  );
  assert.equal(decision.kind === "flag" && decision.mark.limitSec, 8 * 3600);
  assert.equal(decision.kind === "flag" && decision.mark.resolvedAt, null);
});

test("cap ends the entry at exactly the limit", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "cap" }),
  });

  assert.equal(decision.kind, "end");
  assert.equal(decision.kind === "end" && decision.endMs, START + 8 * HOUR_MS);
  assert.equal(decision.kind === "end" && decision.mark.action, "capped");
});

test("stop ends the entry where it had got to, keeping every second", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "stop" }),
  });

  assert.equal(decision.kind, "end");
  assert.equal(decision.kind === "end" && decision.endMs, MONDAY);
  assert.equal(decision.kind === "end" && decision.mark.action, "stopped");
});

test("a cap discards the overrun and the mark records exactly how much", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "cap" }),
  }) as Extract<RunawayDecision, { kind: "end" }>;

  const keptSec = (decision.endMs - START) / 1000;
  const discardedSec = decision.mark.elapsedSec - keptSec;
  assert.equal(keptSec, 8 * 3600);
  assert.equal(discardedSec, 55 * 3600);
});

// ── long, but under the cap — untouched ──────────────────────────────

test("an entry just under the cap is left alone", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: START + 8 * HOUR_MS - 1000,
    settings: settings({ maxHours: 8, behavior: "cap" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "under-limit" });
});

test("an entry exactly at the cap is left alone — the limit is inclusive", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: START + 8 * HOUR_MS,
    settings: settings({ maxHours: 8, behavior: "cap" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "under-limit" });
});

test("one second past the cap is enough", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: START + 8 * HOUR_MS + 1000,
    settings: settings({ maxHours: 8, behavior: "cap" }),
  });
  assert.equal(decision.kind, "end");
});

// ── the guard disabled — untouched ───────────────────────────────────

test("maxHours 0 leaves a 63-hour timer completely alone", () => {
  for (const behavior of RUNAWAY_BEHAVIORS) {
    const decision = evaluateRunaway({
      startMs: START,
      nowMs: MONDAY,
      settings: settings({ maxHours: 0, behavior }),
    });
    assert.deepEqual(decision, { kind: "none", reason: "disabled" });
  }
});

test("absent settings are the same as disabled, never a crash", () => {
  assert.deepEqual(
    evaluateRunaway({ startMs: START, nowMs: MONDAY, settings: null }),
    { kind: "none", reason: "disabled" },
  );
  assert.deepEqual(
    evaluateRunaway({ startMs: START, nowMs: MONDAY, settings: undefined }),
    { kind: "none", reason: "disabled" },
  );
});

// ── it acts at most once per entry ───────────────────────────────────

test("an entry the guard already marked is never acted on twice", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "ask" }),
    existing: mark(),
  });
  assert.deepEqual(decision, { kind: "none", reason: "already-marked" });
});

test("answering the prompt does not re-arm the guard for that entry", () => {
  // "Keep it" on a genuinely long timer is an answer that has to hold for the
  // life of the entry, or the next read asks again a second later.
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY + HOUR_MS,
    settings: settings({ behavior: "cap" }),
    existing: mark({ resolvedAt: "2026-08-31T09:05:00.000Z" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "already-marked" });
});

// ── interaction with idle detection ──────────────────────────────────

test("the guard has nothing to act on once idle has ended the entry", () => {
  // Idle ends an entry by setting `end`, and the server only ever hands the
  // guard an entry with `end === null`. Whichever sets `end` first wins; this
  // is the shape of the losing call — there is simply no running entry left,
  // so no code path reaches `evaluateRunaway` at all.
  //
  // What the pure decision CAN assert is the other half: the fresh entry a
  // pause-and-resume opens starts now, so it is nowhere near the limit.
  const resumedAt = MONDAY;
  const decision = evaluateRunaway({
    startMs: resumedAt,
    nowMs: resumedAt + 60_000,
    settings: settings({ behavior: "cap" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "under-limit" });
});

test("ask never sets an end, so it cannot race idle at all", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "ask" }),
  });
  // `flag` carries no endMs — the entry is returned to the world exactly as
  // long as it was, and idle stays free to end it at the better instant.
  assert.equal(decision.kind, "flag");
  assert.equal("endMs" in decision, false);
});

test("an entry idle already truncated is judged on its own length", () => {
  // Idle truncated a 63-hour entry back to the 30 minutes before input
  // stopped. The guard, looking at the same entry later, measures 30 minutes.
  const idleTruncatedEnd = START + 30 * 60 * 1000;
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: idleTruncatedEnd,
    settings: settings({ maxHours: 8, behavior: "cap" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "under-limit" });
});

// ── a capped entry keeps what it needs to be corrected ───────────────

test("restore reconstructs the exact span the guard measured", () => {
  const decision = evaluateRunaway({
    startMs: START,
    nowMs: MONDAY,
    settings: settings({ behavior: "cap" }),
  }) as Extract<RunawayDecision, { kind: "end" }>;

  // This is the whole no-silent-deletion contract: `start + elapsedSec` is the
  // moment the guard saw, so the 55 discarded hours are one call away.
  assert.equal(
    resolvedEndMs("restore", START, decision.mark),
    MONDAY,
  );
});

test("cap is recomputed from the mark, never taken off the wire", () => {
  assert.equal(
    resolvedEndMs("cap", START, mark({ limitSec: 8 * 3600 }), START + 999),
    START + 8 * HOUR_MS,
  );
});

test("keep changes nothing", () => {
  assert.equal(resolvedEndMs("keep", START, mark(), MONDAY), null);
});

test("end-at is the only resolution that trusts a supplied instant", () => {
  const chosen = START + 3 * HOUR_MS;
  assert.equal(resolvedEndMs("end-at", START, mark(), chosen), chosen);
  assert.equal(resolvedEndMs("end-at", START, mark()), null);
});

// ── absolute elapsed time, no calendar arithmetic ────────────────────

test("a DST transition changes nothing — elapsed time is a subtraction", () => {
  // Europe/Berlin fell back at 03:00 local on 2026-10-25. An entry spanning it
  // is 9 wall-clock hours but 10 real hours, and the guard measures the real
  // ten. Nothing here consults a time zone.
  const before = Date.parse("2026-10-24T23:00:00.000Z");
  const after = Date.parse("2026-10-25T09:00:00.000Z");
  const decision = evaluateRunaway({
    startMs: before,
    nowMs: after,
    settings: settings({ maxHours: 9, behavior: "cap" }),
  });
  assert.equal(decision.kind, "end");
  assert.equal(
    decision.kind === "end" && decision.mark.elapsedSec,
    10 * 3600,
  );
});

test("a clock that has gone backwards produces no negative elapsed time", () => {
  const decision = evaluateRunaway({
    startMs: MONDAY,
    nowMs: START,
    settings: settings({ behavior: "cap" }),
  });
  assert.deepEqual(decision, { kind: "none", reason: "under-limit" });
});
