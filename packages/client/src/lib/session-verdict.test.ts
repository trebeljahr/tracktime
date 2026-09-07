import { describe, expect, it } from "vitest";

import {
  verdictForRejection,
  verdictForResult,
} from "@/lib/session-verdict";

const web = { hasStoredToken: false };
const phone = { hasStoredToken: true };

describe("verdictForResult", () => {
  it("signs a user in when the server returns a session", () => {
    expect(verdictForResult({ data: { session: { id: "s1" } } }, web)).toBe("in");
    expect(verdictForResult({ data: { session: { id: "s1" } } }, phone)).toBe(
      "in",
    );
  });

  it("signs a user out when the server cleanly says there is no session", () => {
    // `{ data: null, error: null }` is the only honest sign-out: the server
    // was reached and it answered.
    expect(verdictForResult({ data: null, error: null }, web)).toBe("out");
    expect(verdictForResult({ data: null, error: null }, phone)).toBe("out");
  });

  it("keeps a stored session through an HTTP-level failure", () => {
    // @better-fetch/fetch resolves rather than rejects on an error response,
    // so a 502 mid-redeploy arrives here and not in the .catch(). Without
    // this branch a proxy hiccup signs a phone out and unmounts its running
    // timer.
    const proxyError = { data: null, error: { status: 502 } };

    expect(verdictForResult(proxyError, phone)).toBe("in");
    expect(verdictForResult(proxyError, web)).toBe("out");
  });

  it("treats a missing result as no answer", () => {
    expect(verdictForResult(undefined, web)).toBe("out");
    expect(verdictForResult(null, phone)).toBe("out");
  });
});

describe("verdictForRejection", () => {
  it("keeps a stored session when the transport failed outright", () => {
    // Cold launch on the underground. The token is the evidence that this
    // device signed in; a dead radio is not evidence that it signed out.
    expect(verdictForRejection(phone)).toBe("in");
  });

  it("still sends a tokenless client to /login", () => {
    expect(verdictForRejection(web)).toBe("out");
  });
});
