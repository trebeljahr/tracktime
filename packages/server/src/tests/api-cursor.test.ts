// Cursors round-trip, and stay opaque.
//
// A cursor is the one piece of API state a caller holds across requests, so a
// decode bug does not error — it silently pages from the wrong place, skipping
// or repeating rows nobody notices until the totals disagree.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCursor, encodeCursor } from "../services/cursor.js";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips an ordinary keyset position", () => {
    const cursor = encodeCursor("2026-08-21T09:15:00.000Z", "65f1c2d3e4f5a6b7c8d9e0f1");
    assert.deepEqual(decodeCursor(cursor), {
      sortKey: "2026-08-21T09:15:00.000Z",
      id: "65f1c2d3e4f5a6b7c8d9e0f1",
    });
  });

  it("round-trips an id that CONTAINS the separator", () => {
    // Split from the left, not the right: the sort key never contains `|`,
    // but an id is caller-visible data that one day might. Splitting from the
    // right would cut such an id in half and page from a position that does
    // not exist.
    const id = "weird|id|with|pipes";
    const cursor = encodeCursor("2026-08-21T09:15:00.000Z", id);
    assert.deepEqual(decodeCursor(cursor), {
      sortKey: "2026-08-21T09:15:00.000Z",
      id,
    });
  });

  it("round-trips non-ASCII and URL-hostile characters", () => {
    const cursor = encodeCursor("Ünïcode +/= key", "id with spaces & ?");
    assert.deepEqual(decodeCursor(cursor), {
      sortKey: "Ünïcode +/= key",
      id: "id with spaces & ?",
    });
  });

  it("is base64url, so it survives a query string untouched", () => {
    for (let i = 0; i < 200; i += 1) {
      const cursor = encodeCursor(
        new Date(1_700_000_000_000 + i * 97_003).toISOString(),
        `65f1c2d3e4f5a6b7c8d9${String(i).padStart(4, "0")}`,
      );
      assert.match(cursor, /^[A-Za-z0-9_-]+$/, cursor);
      assert.equal(encodeURIComponent(cursor), cursor);
    }
  });

  it("does not leak the sort key to a caller reading it", () => {
    const cursor = encodeCursor("2026-08-21T09:15:00.000Z", "abc");
    assert.ok(!cursor.includes("2026"));
    assert.ok(!cursor.includes("|"));
  });

  it("returns null for anything that is not a cursor", () => {
    // Null rather than throwing: a stale or mangled cursor is a caller
    // mistake to answer with a 400 or an empty page, never a 500.
    assert.equal(decodeCursor(""), null);
    // Decodes as base64url, but carries no separator.
    assert.equal(decodeCursor(Buffer.from("nopipe").toString("base64url")), null);
    // Separator at position zero — an empty sort key addresses nothing.
    assert.equal(decodeCursor(Buffer.from("|abc").toString("base64url")), null);
    // Separator at the end — an empty id addresses nothing.
    assert.equal(decodeCursor(Buffer.from("2026|").toString("base64url")), null);
  });
});
