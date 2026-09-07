// The keyset cursor encoding used by the routes that page on THIS module.
//
// Not every cursor the API hands out — deliberately not, and saying so is the
// point of this paragraph. Two paginated routes predate it and keep their own
// `<sortKey>|<id>`, unencoded:
//
//   - `GET /api/v1/entries` pages with `encodeEntryCursor` in
//     `services/entries/list.ts`. Cursors already in flight are the one piece
//     of state a deploy cannot migrate, so re-encoding that one would make
//     every open list page jump to the top mid-scroll. Its decoder does accept
//     a value from here, so a caller handed one by another route is not stuck.
//   - `GET /api/v1/reports/detailed` pages with the `encodeCursor` local to
//     `trpc/routers/reports.ts`, shared with the tRPC procedure the web app
//     calls, so the two surfaces cannot disagree about a page boundary.
//
// A shared module on the security-adjacent side of the codebase that CLAIMS
// to be the single source of truth and is not is worse than one that claims
// nothing: the next reader takes "cursors are opaque" for a property of the
// API rather than of this file, and reasons about those two as if they had it.
//
// A cursor from here is an OPAQUE token, and it has to stay one: the moment a
// caller can read `2026-08-21T09:00:00.000Z|65f…` out of it, somebody starts
// constructing them by hand and the sort key becomes part of the contract. base64url
// (not plain base64) because these travel in query strings, where `+` becomes
// a space and `/` and `=` need escaping.
//
// Never an OFFSET. A `skip`-based page silently repeats or drops rows whenever
// something is written between two requests, which for a time tracker is
// "always" — the entry list is exactly the thing being appended to while it is
// being read.

/** `|` separates the sort key from the id; the key never contains one. */
const SEPARATOR = "|";

/** Encode a keyset position. `sortKey` is whatever the query sorts on. */
export function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(`${sortKey}${SEPARATOR}${id}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Decode a cursor, or `null` when it is not one.
 *
 * Split on the FIRST separator, not the last: the sort key is a timestamp or
 * a name and never contains `|`, whereas an id is caller-visible data that one
 * day might. Splitting from the right would then cut a valid id in half and
 * page from a position that does not exist.
 *
 * Returns null rather than throwing — a stale or mangled cursor is a caller
 * mistake to answer with an empty page or a 400, never a 500.
 */
export function decodeCursor(
  raw: string,
): { sortKey: string; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const at = decoded.indexOf(SEPARATOR);
  if (at <= 0) return null;

  const sortKey = decoded.slice(0, at);
  const id = decoded.slice(at + 1);
  if (id.length === 0) return null;
  return { sortKey, id };
}
