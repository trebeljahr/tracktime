/**
 * The session window is 30 days for every client, and that is on purpose.
 *
 * The number arrived as a mobile fix — a phone left in a drawer over a holiday
 * comes back to a deleted session and replays a day of offline-tracked time
 * into 401s. But better-auth's `session.expiresIn` is global: the same value
 * creates the row, refreshes it, and sets the browser cookie's `max-age`. So
 * every web session went from 7 days to 30 at the same time, and nothing said
 * so. The fix was to say so.
 *
 * These specs pin the number and pin the fact that the argument travels with
 * it: the constants module is where the reasoning lives, `auth.ts` reads it
 * from there rather than re-inlining an arithmetic expression, and the web
 * consequence is spelled out where the next person will look. Asserting on
 * prose is unusual and deliberate — the defect here was an undocumented
 * decision, so the documentation is the fix and deleting it is the regression.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "../auth/session-lifetime.js";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("session lifetime", () => {
  it("is 30 days, not better-auth's 7", () => {
    assert.equal(SESSION_EXPIRES_IN_SECONDS, 60 * 60 * 24 * 30);
  });

  it("refreshes at most once a day", () => {
    assert.equal(SESSION_UPDATE_AGE_SECONDS, 60 * 60 * 24);
    assert.ok(
      SESSION_UPDATE_AGE_SECONDS < SESSION_EXPIRES_IN_SECONDS,
      "a session that refreshes less often than it expires is already expired",
    );
  });

  it("is read by auth.ts from the module that argues for it", () => {
    const auth = read("../auth/auth.ts");
    assert.match(auth, /expiresIn: SESSION_EXPIRES_IN_SECONDS/);
    assert.match(auth, /updateAge: SESSION_UPDATE_AGE_SECONDS/);
    assert.doesNotMatch(
      auth,
      /expiresIn: 60 \* 60/,
      "inline the number and the reasoning stops travelling with it",
    );
  });

  it("says out loud that it lengthens web browser sessions too", () => {
    const module = read("../auth/session-lifetime.ts").toLowerCase();
    for (const word of ["global", "browser", "cookie", "web app"]) {
      assert.ok(
        module.includes(word),
        `the rationale no longer mentions "${word}" — the web consequence is ` +
          "the whole reason this constant has its own file",
      );
    }
  });
});
