/**
 * Unit tests for the idle decision machine in @starter/core.
 *
 * It owns no clock and no detector — every reading is handed in with an
 * explicit `atMs` — so an eight-hour idle span is one function call and every
 * behaviour, threshold and cross-device rule is deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  createIdleWatcher,
  describeIdleSpan,
  formatIdleSpan,
  resolveIdleSettings,
  type IdleBehavior,
  type IdlePlan,
  type IdleSettings,
  type IdleTimerRef,
  type IdleWatcher,
} from "@starter/core";

const MINUTE = 60_000;

/** 2026-09-02T09:00:00Z, so every ISO string in an assertion is readable. */
const T0 = Date.parse("2026-09-02T09:00:00.000Z");

const at = (minutes: number): number => T0 + minutes * MINUTE;
const iso = (minutes: number): string => new Date(at(minutes)).toISOString();

const settings = (patch: Partial<IdleSettings> = {}): IdleSettings => ({
  enabled: true,
  thresholdMinutes: 10,
  behavior: "ask",
  lockIsImmediate: true,
  ...patch,
});

/** A timer started at T0 on the device under test. */
const TIMER: IdleTimerRef = {
  id: "entry-1",
  start: iso(0),
  description: "Writing the spec",
  projectId: "project-1",
  taskId: null,
  billable: true,
};

/** A watcher that has already claimed TIMER, as its own start would. */
const ownedWatcher = (): IdleWatcher => {
  const watcher = createIdleWatcher();
  watcher.noteLocalStart(TIMER.id, at(0));
  return watcher;
};

const observeIdle = (
  watcher: IdleWatcher,
  options: {
    atMinutes: number;
    idleSinceMinutes: number;
    config?: IdleSettings;
    signal?: "idle" | "locked";
    timer?: IdleTimerRef | null;
  }
): IdlePlan =>
  watcher.observe({
    signal: options.signal ?? "idle",
    atMs: at(options.atMinutes),
    idleSinceMs: at(options.idleSinceMinutes),
    timer: options.timer === undefined ? TIMER : options.timer,
    settings: options.config ?? settings(),
  });

describe("createIdleWatcher — thresholds", () => {
  it("says nothing until the threshold has passed", () => {
    const watcher = ownedWatcher();
    expect(
      observeIdle(watcher, { atMinutes: 9, idleSinceMinutes: 0 })
    ).toEqual({ kind: "none" });
  });

  it("raises the decision once the threshold is reached", () => {
    const watcher = ownedWatcher();
    const plan = observeIdle(watcher, { atMinutes: 10, idleSinceMinutes: 0 });
    expect(plan.kind).toBe("prompt");
  });

  it("does nothing at all when detection is switched off", () => {
    const watcher = ownedWatcher();
    expect(
      observeIdle(watcher, {
        atMinutes: 60,
        idleSinceMinutes: 0,
        config: settings({ enabled: false }),
      })
    ).toEqual({ kind: "none" });
  });

  it("only decides once for one idle span", () => {
    const watcher = ownedWatcher();
    expect(
      observeIdle(watcher, { atMinutes: 10, idleSinceMinutes: 0 }).kind
    ).toBe("prompt");
    // A poller repeats itself; the same span must not fire twice.
    expect(
      observeIdle(watcher, { atMinutes: 11, idleSinceMinutes: 0 })
    ).toEqual({ kind: "none" });
  });
});

describe("createIdleWatcher — behaviours", () => {
  const planFor = (behavior: IdleBehavior): IdlePlan =>
    observeIdle(ownedWatcher(), {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior }),
    });

  it("ask keeps the timer running and offers the choice", () => {
    const plan = planFor("ask");
    expect(plan).toMatchObject({
      kind: "prompt",
      pending: {
        entryId: "entry-1",
        idleStartedAt: iso(5),
        idleSec: 40 * 60,
        truncateAt: iso(5),
      },
    });
  });

  it("pause-and-resume truncates at the idle start and waits for input", () => {
    expect(planFor("pause-and-resume")).toMatchObject({
      kind: "truncate",
      entryId: "entry-1",
      endAt: iso(5),
      resume: "on-return",
      seed: {
        description: "Writing the spec",
        projectId: "project-1",
        taskId: null,
        billable: true,
      },
    });
  });

  it("stop truncates and stays stopped", () => {
    expect(planFor("stop")).toMatchObject({
      kind: "truncate",
      endAt: iso(5),
      resume: "never",
    });
  });

  it("keep-running never touches the entry", () => {
    expect(planFor("keep-running")).toEqual({ kind: "none" });
  });

  it("keep-running leaves nothing settled, so the setting can change later", () => {
    const watcher = ownedWatcher();
    observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "keep-running" }),
    });
    // Same span, now under `ask` — the earlier no-op must not have suppressed it.
    expect(
      observeIdle(watcher, {
        atMinutes: 46,
        idleSinceMinutes: 5,
        config: settings({ behavior: "ask" }),
      }).kind
    ).toBe("prompt");
  });
});

describe("createIdleWatcher — the prompt's answers", () => {
  const promptedWatcher = (): IdleWatcher => {
    const watcher = ownedWatcher();
    observeIdle(watcher, { atMinutes: 45, idleSinceMinutes: 5 });
    return watcher;
  };

  it("'I was working' changes nothing about the entry", () => {
    const watcher = promptedWatcher();
    expect(watcher.answer("keep", at(46))).toEqual({ kind: "none" });
    expect(watcher.pending()).toBeNull();
  });

  it("'I was working' re-arms, measuring the next span from the answer", () => {
    const watcher = promptedWatcher();
    watcher.answer("keep", at(46));

    // The detector still reports the original idle start; it must be ignored
    // in favour of the answer, or the next reading re-prompts immediately.
    expect(
      observeIdle(watcher, { atMinutes: 50, idleSinceMinutes: 5 })
    ).toEqual({ kind: "none" });
    expect(
      observeIdle(watcher, { atMinutes: 56, idleSinceMinutes: 5 }).kind
    ).toBe("prompt");
  });

  it("discard truncates to the idle start and stays stopped", () => {
    expect(promptedWatcher().answer("discard", at(46))).toMatchObject({
      kind: "truncate",
      endAt: iso(5),
      idleSec: 40 * 60,
      resume: "never",
    });
  });

  it("discard-and-resume truncates and reopens immediately", () => {
    expect(
      promptedWatcher().answer("discard-and-resume", at(46))
    ).toMatchObject({
      kind: "truncate",
      endAt: iso(5),
      resume: "now",
      seed: { description: "Writing the spec", billable: true },
    });
  });

  it("answering twice is a no-op — the span is gone", () => {
    const watcher = promptedWatcher();
    watcher.answer("discard", at(46));
    expect(watcher.answer("discard", at(47))).toEqual({ kind: "none" });
  });
});

describe("createIdleWatcher — pause then resume", () => {
  it("reopens the same work when input comes back", () => {
    const watcher = ownedWatcher();
    const paused = observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });
    expect(paused).toMatchObject({ kind: "truncate", resume: "on-return" });

    const resumed = watcher.observe({
      signal: "active",
      atMs: at(50),
      timer: null,
      settings: settings({ behavior: "pause-and-resume" }),
    });

    expect(resumed).toEqual({
      kind: "resume",
      startAt: iso(50),
      seed: {
        description: "Writing the spec",
        projectId: "project-1",
        taskId: null,
        billable: true,
      },
    });
  });

  it("resumes exactly once", () => {
    const watcher = ownedWatcher();
    observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });
    watcher.observe({
      signal: "active",
      atMs: at(50),
      timer: null,
      settings: settings(),
    });
    expect(
      watcher.observe({
        signal: "active",
        atMs: at(51),
        timer: null,
        settings: settings(),
      })
    ).toEqual({ kind: "none" });
  });

  it("resumes on a short idle span, not only on a literal 'active'", () => {
    // A poller that reports its raw counter says "idle, 3 seconds" for
    // somebody typing continuously. Trusting the label rather than the span
    // would leave the resume waiting forever.
    const watcher = ownedWatcher();
    observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });

    expect(
      watcher.observe({
        signal: "idle",
        atMs: at(50),
        idleSinceMs: at(50) - 3000,
        timer: null,
        settings: settings({ behavior: "pause-and-resume" }),
      })
    ).toMatchObject({ kind: "resume", startAt: iso(50) });
  });

  it("does not resume over a timer something else already started", () => {
    const watcher = ownedWatcher();
    observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });

    // Another device started a different entry while we were away. Reopening
    // ours would stop theirs, thanks to the one-running-timer invariant.
    const other: IdleTimerRef = { ...TIMER, id: "entry-2", start: iso(48) };
    expect(
      watcher.observe({
        signal: "active",
        atMs: at(50),
        timer: other,
        settings: settings(),
      })
    ).toEqual({ kind: "none" });
  });
});

describe("createIdleWatcher — a locked screen", () => {
  it("does not wait out the threshold", () => {
    expect(
      observeIdle(ownedWatcher(), {
        atMinutes: 1,
        idleSinceMinutes: 1,
        signal: "locked",
      })
    ).toMatchObject({ kind: "prompt", pending: { signal: "locked" } });
  });

  it("still waits when the user has turned that off", () => {
    expect(
      observeIdle(ownedWatcher(), {
        atMinutes: 1,
        idleSinceMinutes: 1,
        signal: "locked",
        config: settings({ lockIsImmediate: false }),
      })
    ).toEqual({ kind: "none" });
  });
});

describe("createIdleWatcher — idle is per device, the timer is not", () => {
  it("ignores a timer this device did not start", () => {
    // The headline case: a second laptop, left open, sees the running entry
    // over sync and falls asleep. It must not touch it.
    const watcher = createIdleWatcher();
    expect(
      observeIdle(watcher, { atMinutes: 60, idleSinceMinutes: 0 })
    ).toEqual({ kind: "none" });
  });

  it("ignores an entry started elsewhere after our own was replaced", () => {
    const watcher = ownedWatcher();
    const theirs: IdleTimerRef = { ...TIMER, id: "entry-2" };
    expect(
      observeIdle(watcher, {
        atMinutes: 60,
        idleSinceMinutes: 0,
        timer: theirs,
      })
    ).toEqual({ kind: "none" });
  });

  it("measures the idle span from another device's last sign of life", () => {
    const watcher = ownedWatcher();
    // This device saw no input from T0, but the person was on the desktop at
    // T+30 — so at T+35 they have only been idle five minutes, not thirty-five.
    watcher.noteRemoteActivity(at(30));
    expect(
      observeIdle(watcher, { atMinutes: 35, idleSinceMinutes: 0 })
    ).toEqual({ kind: "none" });

    expect(
      observeIdle(watcher, { atMinutes: 41, idleSinceMinutes: 0 })
    ).toMatchObject({ kind: "prompt", pending: { idleStartedAt: iso(30) } });
  });

  it("does not spend a resume just because another device is busy", () => {
    // Proof of life from elsewhere pushes the idle floor forward, which can
    // drop the span under the threshold. That is not this device's person
    // coming back, so it must not reopen their entry.
    const watcher = ownedWatcher();
    observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });
    watcher.noteRemoteActivity(at(48));

    expect(
      observeIdle(watcher, {
        atMinutes: 50,
        idleSinceMinutes: 5,
        timer: null,
        config: settings({ behavior: "pause-and-resume" }),
      })
    ).toEqual({ kind: "none" });
  });

  it("keeps out of it once the timer is stopped", () => {
    const watcher = ownedWatcher();
    expect(
      observeIdle(watcher, {
        atMinutes: 60,
        idleSinceMinutes: 0,
        timer: null,
      })
    ).toEqual({ kind: "none" });
  });

  it("releases the claim when the user stops the timer by hand", () => {
    const watcher = ownedWatcher();
    watcher.noteLocalStop(at(20));
    expect(
      observeIdle(watcher, { atMinutes: 60, idleSinceMinutes: 0 })
    ).toEqual({ kind: "none" });
  });
});

describe("createIdleWatcher — never destroys tracked time", () => {
  it("never truncates before the entry started", () => {
    const watcher = createIdleWatcher();
    const late: IdleTimerRef = { ...TIMER, start: iso(30) };
    watcher.noteLocalStart(late.id, at(30));

    // The detector reports input stopping at T0, before this entry existed.
    const plan = observeIdle(watcher, {
      atMinutes: 45,
      idleSinceMinutes: 0,
      timer: late,
      config: settings({ behavior: "stop" }),
    });

    // Clamped to the entry's start plus the one second that keeps it alive,
    // rather than to an `end` at or before the start the server would refuse.
    expect(plan).toMatchObject({
      kind: "truncate",
      endAt: new Date(at(30) + 1000).toISOString(),
      idleStartedAt: iso(30),
    });
  });

  it("leaves a second on an entry that is idle from its first instant", () => {
    // `end > start` is a server invariant, and detection is never allowed to
    // delete: the worst case is a one-second row, which the existing
    // sub-minute toast then offers to discard.
    const pending = describeIdleSpan({
      timer: TIMER,
      idleStartedAtMs: at(0),
      detectedAtMs: at(20),
      signal: "idle",
    });
    expect(Date.parse(pending.truncateAt)).toBeGreaterThan(Date.parse(TIMER.start));
    expect(pending.idleStartedAt).toBe(iso(0));
  });
});

describe("createIdleWatcher — surviving a process that does not", () => {
  it("carries its ownership claim across a restore", () => {
    const first = ownedWatcher();
    const saved = first.state();

    // What an evicted MV3 service worker does on the next event.
    const revived = createIdleWatcher(saved);
    expect(
      observeIdle(revived, { atMinutes: 10, idleSinceMinutes: 0 }).kind
    ).toBe("prompt");
  });

  it("carries a pending prompt across a restore", () => {
    const first = ownedWatcher();
    observeIdle(first, { atMinutes: 45, idleSinceMinutes: 5 });

    const revived = createIdleWatcher(first.state());
    expect(revived.pending()).toMatchObject({ idleStartedAt: iso(5) });
    expect(revived.answer("discard", at(46))).toMatchObject({
      kind: "truncate",
      endAt: iso(5),
    });
  });

  it("carries a waiting resume across a restore", () => {
    const first = ownedWatcher();
    observeIdle(first, {
      atMinutes: 45,
      idleSinceMinutes: 5,
      config: settings({ behavior: "pause-and-resume" }),
    });

    const revived = createIdleWatcher(first.state());
    expect(
      revived.observe({
        signal: "active",
        atMs: at(50),
        timer: null,
        settings: settings(),
      })
    ).toMatchObject({ kind: "resume", startAt: iso(50) });
  });

  it("forgets everything on reset", () => {
    const watcher = ownedWatcher();
    watcher.reset();
    expect(watcher.state()).toEqual({
      ownedEntryId: null,
      idleFloorMs: 0,
      pending: null,
      settledEntryId: null,
      awaitingResume: null,
    });
  });
});

describe("resolveIdleSettings", () => {
  const workspace = settings({ behavior: "pause-and-resume" });

  it("inherits the workspace behaviour when the project has none", () => {
    expect(resolveIdleSettings(workspace, null).behavior).toBe(
      "pause-and-resume"
    );
    expect(resolveIdleSettings(workspace, undefined).behavior).toBe(
      "pause-and-resume"
    );
  });

  it("lets a low-input project opt out of being paused", () => {
    expect(resolveIdleSettings(workspace, "keep-running").behavior).toBe(
      "keep-running"
    );
  });

  it("cannot switch detection on for a workspace that has it off", () => {
    const off = settings({ enabled: false });
    expect(resolveIdleSettings(off, "stop").enabled).toBe(false);
  });

  it("a project override reaches the decision", () => {
    expect(
      observeIdle(ownedWatcher(), {
        atMinutes: 60,
        idleSinceMinutes: 0,
        config: resolveIdleSettings(workspace, "keep-running"),
      })
    ).toEqual({ kind: "none" });
  });
});

describe("formatIdleSpan", () => {
  it("reads in minutes and hours, never seconds", () => {
    expect(formatIdleSpan(0)).toBe("0m");
    expect(formatIdleSpan(10 * 60)).toBe("10m");
    expect(formatIdleSpan(60 * 60)).toBe("1h");
    expect(formatIdleSpan(95 * 60)).toBe("1h 35m");
  });
});
