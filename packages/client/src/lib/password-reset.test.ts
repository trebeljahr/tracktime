// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset } from "./password-reset";

function stubFetch(response: Partial<Response> = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, ...response }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestPasswordReset", () => {
  it("sends redirectTo as an absolute web-app URL, not a relative path", async () => {
    // The API is a different origin from the web app now. better-auth
    // resolves redirectTo against ITS baseURL, so a relative path lands the
    // user on the API host, which serves no reset page.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    const fetchMock = stubFetch();

    await requestPasswordReset("someone@example.test");

    expect(bodyOf(fetchMock).redirectTo).toBe(
      `${window.location.origin}/reset-password`,
    );
  });

  it("posts to the endpoint better-auth actually mounts", async () => {
    // /forget-password is the pre-1.6 name and 404s, which this flow would
    // otherwise report as a sent email.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    const fetchMock = stubFetch();

    await requestPasswordReset("someone@example.test");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/auth/request-password-reset",
    );
  });

  it("throws when the API rejects the request", async () => {
    // An unknown address is a 200, so anything else is a real failure.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    stubFetch({ ok: false, status: 404 });

    await expect(requestPasswordReset("someone@example.test")).rejects.toThrow(
      /404/,
    );
  });
});
