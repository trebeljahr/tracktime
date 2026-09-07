// @vitest-environment jsdom
/**
 * The network verdict.
 *
 * `isNetworkError()` short-circuits on this, so it decides whether a refused
 * mutation is queued for replay or rolled back — and React Query decides
 * whether to fetch at all. On web it must stay exactly what it always was:
 * `navigator.onLine` plus the two window events.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetNetworkForTests,
  getNetworkOnline,
  getServerNetworkOnline,
  subscribeNetwork,
} from "@/mobile/network";

afterEach(() => {
  __resetNetworkForTests();
  vi.unstubAllGlobals();
});

describe("getNetworkOnline", () => {
  it("follows navigator.onLine when the radio has not spoken", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get");

    onLine.mockReturnValue(true);
    expect(getNetworkOnline()).toBe(true);

    onLine.mockReturnValue(false);
    expect(getNetworkOnline()).toBe(false);

    onLine.mockRestore();
  });

  it("assumes online where there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(getNetworkOnline()).toBe(true);
    expect(getServerNetworkOnline()).toBe(true);
  });
});

describe("subscribeNetwork", () => {
  it("notifies on the window events a browser really does fire", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNetwork(listener);

    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
