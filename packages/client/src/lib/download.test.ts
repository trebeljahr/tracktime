// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBase64, downloadBlob } from "./download";

/**
 * jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`, so
 * the test installs both and captures the Blob the code hands over. That
 * capture is the only way to assert on the bytes — an anchor's `href` is just
 * the opaque url string.
 */
let created: Blob[] = [];
let revoked: string[] = [];
let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  clicked = [];
  vi.useFakeTimers();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob): string => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string): void => {
      revoked.push(url);
    },
  });

  // jsdom refuses to actually navigate, so intercept the click instead of
  // letting it produce a "Not implemented: navigation" noise line.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function click(this: HTMLAnchorElement): void {
      clicked.push(this);
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("passes the filename to the anchor and cleans up after itself", () => {
    downloadBlob("report.csv", new Blob(["a,b\n1,2\n"], { type: "text/csv" }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe("report.csv");
    expect(clicked[0]?.rel).toBe("noopener");
    // The anchor is removed again — nothing is left in the document.
    expect(document.querySelector("a")).toBeNull();
  });

  it("defers revoking the object url so Safari's download can start", () => {
    downloadBlob("report.csv", new Blob(["x"]));

    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(revoked).toEqual(["blob:test/1"]);
  });
});

describe("downloadBase64", () => {
  it("decodes to a Blob of the original byte length", async () => {
    // "%PDF-1.7" — eight ASCII bytes.
    const base64 = btoa("%PDF-1.7");

    downloadBase64("report.pdf", base64, "application/pdf");

    expect(created).toHaveLength(1);
    expect(created[0]?.size).toBe(8);
    expect(created[0]?.type).toBe("application/pdf");
    expect(clicked[0]?.download).toBe("report.pdf");
  });

  it("preserves bytes above 0x7f instead of UTF-8 encoding them", async () => {
    // 0xff would become two bytes if the binary string were treated as text.
    const base64 = btoa(String.fromCharCode(0x00, 0x7f, 0x80, 0xff));

    downloadBase64("bytes.pdf", base64, "application/pdf");

    const blob = created[0];
    expect(blob?.size).toBe(4);
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    expect([...bytes]).toEqual([0x00, 0x7f, 0x80, 0xff]);
  });
});
