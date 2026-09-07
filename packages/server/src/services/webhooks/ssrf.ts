// Refusing to be somebody's HTTP proxy into their own network.
//
// A webhook URL is attacker-controlled by construction: anybody who can create
// a subscription can point this server at an address only this server can
// reach — a cloud metadata endpoint, an internal admin panel, a database's
// HTTP interface. That is SSRF, and a URL allowlist alone does not stop it,
// because the name is resolved separately from the check.
import { TRPCError } from "@trpc/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../../config/env.js";

/** Parse a dotted-quad into its four octets, or null. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return null;
  return [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number];
}

/**
 * Parse one `:`-separated run of an IPv6 literal into bytes, or null.
 *
 * A trailing dotted-quad (`::ffff:127.0.0.1`) stands for the final two groups
 * and is legal only in last position — anywhere else it is a malformed address
 * and must not be silently accepted.
 */
function ipv6Chunk(parts: string[]): number[] | null {
  const bytes: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (part.includes(".")) {
      if (i !== parts.length - 1) return null;
      const quad = ipv4Octets(part);
      if (!quad) return null;
      bytes.push(...quad);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    const group = Number.parseInt(part, 16);
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

/**
 * Turn an IPv6 literal into its 16 bytes, or null if it cannot be parsed.
 *
 * Everything below is decided on these bytes rather than on the text, because
 * the text form is NOT what the caller passes in. WHATWG URL re-serializes an
 * address into its shortest hex form:
 *
 *   new URL("https://[::ffff:127.0.0.1]/x").hostname === "[::ffff:7f00:1]"
 *
 * So a guard that pattern-matches the dotted-quad spelling of an IPv4-mapped
 * address never fires in production — `assertDeliverableUrl` only ever sees
 * `::ffff:7f00:1`, and the metadata service at `::ffff:a9fe:a9fe` walks
 * through. Parsing to bytes makes every spelling of one address the same
 * address, which is the only form of this check that can be right.
 */
function ipv6Bytes(ip: string): Uint8Array | null {
  // A zone id (`fe80::1%en0`) selects a local interface, so it is never part
  // of a routable destination — and `isIP` accepts it, so strip it here rather
  // than failing to parse an address that is otherwise well-formed.
  const text = (ip.split("%")[0] ?? "").toLowerCase();
  if (isIP(text) !== 6) return null;

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string): string[] => (part === "" ? [] : part.split(":"));

  const head = ipv6Chunk(split(halves[0] ?? ""));
  if (!head) return null;

  if (halves.length === 1) {
    // No "::" — every one of the eight groups must be spelled out.
    if (head.length !== 16) return null;
    return Uint8Array.from(head);
  }

  const tail = ipv6Chunk(split(halves[1] ?? ""));
  if (!tail) return null;
  // "::" stands for at least one group of zeroes; a run that already fills the
  // address is malformed, and would otherwise let `set` overlap silently.
  if (head.length + tail.length >= 16) return null;

  const bytes = new Uint8Array(16);
  bytes.set(head, 0);
  bytes.set(tail, 16 - tail.length);
  return bytes;
}

/** Does `bytes` start with `prefix`? */
function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * One IPv4 quad carried inside an IPv6 address.
 *
 * `at` is the byte offset of the quad. `complement` marks the fields that
 * RFC 4380 stores bitwise-inverted (see the Teredo entry below) — it is NOT a
 * typo to be "fixed" by dropping the XOR.
 */
type EmbeddedQuad = { readonly at: number; readonly complement: boolean };

type V4Embedding = {
  readonly prefix: readonly number[];
  readonly quads: readonly EmbeddedQuad[];
};

// IPv6 prefixes that carry an IPv4 destination inside them. Every one of these
// reaches a v4 address on a host whose stack implements the transition
// mechanism, so the embedded quad is unwrapped and run through the IPv4 table
// rather than being waved through as ordinary global unicast.
//
//   ::ffff:0:0/96  IPv4-mapped — what a dual-stack socket dials for a v4 host
//   ::/96          IPv4-compatible (deprecated, still routed by some stacks)
//   64:ff9b::/96   the NAT64 well-known prefix — a translator turns this back
//                  into a plain v4 packet, so it reaches the v4 address too
//   2002::/16      6to4 (RFC 3056): the v4 tunnel endpoint is bytes 2..5, so
//                  `2002:a9fe:a9fe::` is the cloud metadata service and
//                  `2002:7f00:1::` is loopback. Still configured on some
//                  Windows and legacy Linux images, where a subscription
//                  pointed at one POSTs the signed envelope inward and hands
//                  the response status back through the delivery log.
//   2001:0::/32    Teredo (RFC 4380): TWO v4 addresses — the relay server at
//                  bytes 4..7 in the clear, and the client at bytes 12..15
//                  stored as its bitwise complement (the field is inverted on
//                  the wire so a literal v4 address never appears in the
//                  packet and trips NAT rewriting middleboxes). Both are
//                  checked, and the complement is deliberate: without the XOR
//                  the client field decodes to a different address entirely.
//
// Missing any of them means loopback and the cloud metadata address are one
// spelling away from being reachable.
const V4_EMBEDDING_PREFIXES: readonly V4Embedding[] = [
  { prefix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], quads: [{ at: 12, complement: false }] },
  { prefix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], quads: [{ at: 12, complement: false }] },
  {
    prefix: [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0],
    quads: [{ at: 12, complement: false }],
  },
  { prefix: [0x20, 0x02], quads: [{ at: 2, complement: false }] },
  {
    prefix: [0x20, 0x01, 0x00, 0x00],
    quads: [
      { at: 4, complement: false },
      { at: 12, complement: true },
    ],
  },
];

/** Read the IPv4 quad an embedding stores at `at`, undoing any complement. */
function embeddedQuad(bytes: Uint8Array, quad: EmbeddedQuad): string {
  const octet = (i: number): number => {
    const byte = bytes[i] ?? 0;
    return quad.complement ? byte ^ 0xff : byte;
  };
  return [octet(quad.at), octet(quad.at + 1), octet(quad.at + 2), octet(quad.at + 3)].join(".");
}

/**
 * Is this address one no customer endpoint could legitimately live at?
 *
 * Pure and DNS-free on purpose: the interesting half of an SSRF guard is
 * "which ranges", and that is a table worth unit-testing exhaustively without
 * a network. `assertDeliverableUrl` below is the part that does I/O.
 *
 * Blocks, for IPv4: 0.0.0.0/8 (this network), 10/8, 100.64/10 (CGNAT),
 * 127/8 (loopback), 169.254/16 (link-local — the cloud metadata address lives
 * here), 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15
 * (benchmarking), 224/4 (multicast), 240/4 (reserved) and the broadcast
 * address. For IPv6: the unspecified address, loopback, unique-local (fc00::/7),
 * link-local (fe80::/10), site-local (fec0::/10, deprecated but still routed on
 * old on-prem networks), multicast (ff00::/8) and the RFC 6666 discard prefix
 * (100::/64).
 *
 * IPv6 is decided on the parsed 16 bytes, never on the text form, and any
 * address embedding an IPv4 destination (::ffff:0:0/96, ::/96, 64:ff9b::/96,
 * 6to4's 2002::/16, Teredo's 2001:0::/32) is unwrapped and re-checked against
 * the IPv4 table — both of Teredo's quads, one of which is stored
 * complemented. An IPv6 literal that cannot be parsed is blocked — see the
 * comment in the branch.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return true; // Not an address at all — fail closed.

  if (version === 6) {
    const bytes = ipv6Bytes(ip);
    // An address this guard cannot take apart is an address it cannot
    // classify, and a guard that does not understand an address must never
    // conclude it is safe. There is deliberately no "unrecognized therefore
    // allowed" path anywhere in this branch: the only `return false` below
    // sits after a successful 16-byte parse that matched no reserved range.
    if (!bytes) return true;

    // :: (unspecified) and ::1 (loopback).
    if (bytes.every((byte) => byte === 0)) return true;
    if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;

    // An embedded IPv4 destination is an IPv4 destination — re-check it
    // against the v4 table rather than against the v6 masks, which would
    // classify `::ffff:a9fe:a9fe` (169.254.169.254) as ordinary global
    // unicast and hand out the cloud metadata service. A transition prefix
    // carrying a PUBLIC v4 address is a public destination, so a non-match
    // falls through to the masks below rather than allowing outright.
    for (const embedding of V4_EMBEDDING_PREFIXES) {
      if (!hasPrefix(bytes, embedding.prefix)) continue;
      for (const quad of embedding.quads) {
        if (isBlockedAddress(embeddedQuad(bytes, quad))) return true;
      }
    }

    const first = bytes[0] ?? 0;
    const second = bytes[1] ?? 0;
    // fc00::/7 — unique local.
    if ((first & 0xfe) === 0xfc) return true;
    // fe80::/10 — link local.
    if (first === 0xfe && (second & 0xc0) === 0x80) return true;
    // fec0::/10 — deprecated site-local. Deprecated is not the same as
    // unreachable: an on-prem network still numbered in site-local space is
    // reachable by exactly the class of address the fc00::/7 rule exists to
    // keep a webhook from dialling.
    if (first === 0xfe && (second & 0xc0) === 0xc0) return true;
    // ff00::/8 — multicast.
    if (first === 0xff) return true;
    // 100::/64 — RFC 6666 discard-only. Not a customer endpoint under any
    // reading, and a delivery aimed at it is a black hole that only ever
    // burns retries.
    if (hasPrefix(bytes, [0x01, 0, 0, 0, 0, 0, 0, 0])) return true;

    // Parsed, and inside none of the reserved ranges: ordinary global unicast.
    return false;
  }

  const octets = ipv4Octets(ip);
  if (!octets) return true;
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true; // 192.0.2/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + broadcast
  return false;
}

const badUrl = (message: string): TRPCError =>
  new TRPCError({ code: "BAD_REQUEST", message });

/**
 * Resolve a webhook URL and refuse it if any address behind it is internal.
 *
 * Three things this does that a naive check does not:
 *
 *  - Rejects every scheme but http(s). `file:`, `gopher:` and friends turn a
 *    delivery into a local read.
 *  - Checks EVERY address the name resolves to (`{ all: true }`), not just the
 *    first. A host with one public A record and one private one would pass a
 *    first-address check and then be dialled at whichever the OS picked.
 *  - Is called again immediately BEFORE each delivery, not only at subscribe
 *    time. DNS rebinding — a name that answers publicly once and privately
 *    afterwards — makes a create-time-only check purely decorative.
 *
 * `WEBHOOK_ALLOW_PRIVATE_TARGETS` exists for local development against a
 * listener on localhost. It also relaxes the https requirement, because there
 * is no certificate for `localhost` worth insisting on.
 */
export async function assertDeliverableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badUrl("That is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badUrl("A webhook URL must be http or https");
  }

  const allowPrivate = env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  if (!allowPrivate && url.protocol !== "https:") {
    throw badUrl("A webhook URL must use https");
  }

  // A literal address skips DNS entirely; there is nothing to resolve and
  // nothing to rebind.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    if (!allowPrivate && isBlockedAddress(hostname)) {
      throw badUrl("That address is not reachable from this server");
    }
    return url;
  }

  if (allowPrivate) return url;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw badUrl("That host could not be resolved");
  }
  if (addresses.length === 0) throw badUrl("That host could not be resolved");

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw badUrl("That address is not reachable from this server");
    }
  }

  return url;
}
