/**
 * What a failed child process of `scripts/build-mobile.mjs` says.
 *
 * `\`pnpm build:client\` exited with 1` is true and useless: it reads the same
 * whether the code does not compile or whether the machine hit `EMFILE`
 * because three agents were building at once, and the difference decides
 * whether you debug or just run it again. The build's own stderr is now
 * captured as well as streamed, so the tail is repeated right under the
 * failure line instead of being several hundred lines up the scrollback.
 *
 * Run by the server package's `test` script (`pnpm test:unit`) — it is the
 * project's plain-node suite, and this file is deliberately outside any
 * package's `src` so `tsc` never sees a `.mjs` it has no types for.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STDERR_TAIL_LINES,
  describeChildFailure,
  stderrTail,
} from "./child-failure.mjs";

describe("stderrTail", () => {
  it("is empty for nothing, whitespace, or a non-string", () => {
    assert.equal(stderrTail(""), "");
    assert.equal(stderrTail("   \n\n  "), "");
    assert.equal(stderrTail(undefined), "");
    assert.equal(stderrTail(null), "");
  });

  it("keeps the LAST lines — the error is at the bottom", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const tail = stderrTail(lines, 3);
    assert.equal(tail, "line 47\nline 48\nline 49");
  });

  it("drops blank lines so the tail is 20 lines of signal", () => {
    const noisy = ["a", "", "  ", "b", "", "c"].join("\n");
    assert.equal(stderrTail(noisy, 3), "a\nb\nc");
  });

  it("defaults to a bounded number of lines", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
    assert.equal(stderrTail(lines).split("\n").length, STDERR_TAIL_LINES);
  });
});

describe("describeChildFailure", () => {
  it("quotes the stderr tail, which is what tells EMFILE from a real break", () => {
    const message = describeChildFailure({
      command: "pnpm",
      args: ["build:client"],
      status: 1,
      stderr:
        "webpack compiled\nError: EMFILE: too many open files, open '/x/y.ts'\n",
    });

    assert.match(message, /`pnpm build:client` exited with 1/);
    assert.match(message, /EMFILE: too many open files/);
  });

  it("names the signal rather than saying 'a signal'", () => {
    const message = describeChildFailure({
      command: "pnpm",
      args: ["build:client"],
      status: null,
      signal: "SIGKILL",
      stderr: "",
    });

    assert.match(message, /was killed by SIGKILL/);
    assert.doesNotMatch(message, /exited with null/);
  });

  it("says so plainly when the child wrote no stderr at all", () => {
    const message = describeChildFailure({
      command: "npx",
      args: ["cap", "sync", "ios"],
      status: 2,
      stderr: "   \n",
    });

    assert.match(message, /wrote nothing to stderr/);
  });

  it("indents the tail so it reads as quoted output, not as the message", () => {
    const message = describeChildFailure({
      command: "pnpm",
      args: ["build:client"],
      status: 1,
      stderr: "boom",
    });

    assert.ok(message.includes("\n    boom"));
  });
});
