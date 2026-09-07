// The address table behind the SSRF guard.
//
// A webhook URL is attacker-controlled by construction: anybody who can create
// a subscription can aim this server at an address only this server can reach.
// The interesting half of the guard is "which ranges", and that is a table —
// so it is tested exhaustively here, without a network, and `isBlockedAddress`
// is pure precisely so that this file can exist.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertDeliverableUrl, isBlockedAddress } from "../services/webhooks/ssrf.js";

const BLOCKED = [
  // IPv4 — "this network", loopback, private, CGNAT, link-local.
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "127.1.2.3",
  // The cloud metadata address. The single most-exploited SSRF target there
  // is, and the reason link-local is on this list at all.
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.1",
  "192.0.2.5",
  "192.168.1.1",
  "198.18.0.1",
  "198.19.255.255",
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
  // IPv6 — unspecified, loopback, unique-local, link-local, multicast.
  "::",
  "::1",
  "fc00::1",
  "fd12:3456:789a::1",
  "fe80::1",
  "ff02::1",
  // IPv4-mapped IPv6: an IPv4 destination wearing a v6 spelling. Missing
  // these is how loopback walks straight through the v6 branch.
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
  "::ffff:10.0.0.1",
  "::ffff:192.168.0.1",
  // The SAME four addresses in the hex spelling — which is the ONLY spelling
  // this function is ever handed in production, because WHATWG URL rewrites
  // `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` before the guard runs. The
  // dotted-quad fixtures above passed against a guard that let every one of
  // these through, which is exactly why they are not sufficient on their own.
  "::ffff:7f00:1",
  "::ffff:a9fe:a9fe",
  "::ffff:a00:5",
  "::ffff:c0a8:1",
  // Fully expanded forms: same addresses, no "::" to key off.
  "0:0:0:0:0:ffff:127.0.0.1",
  "0:0:0:0:0:ffff:7f00:1",
  "0:0:0:0:0:0:0:1",
  "0000:0000:0000:0000:0000:0000:0000:0000",
  // IPv4-compatible (::/96) and the NAT64 well-known prefix: two more ways to
  // write "deliver to this v4 address".
  "::127.0.0.1",
  "64:ff9b::7f00:1",
  "64:ff9b::169.254.169.254",
  // 6to4 (2002::/16) carries the v4 tunnel endpoint at bytes 2..5, so these
  // three reach loopback, the cloud metadata service and a private LAN host
  // on any box with 6to4 still configured — which some Windows and legacy
  // Linux images are.
  "2002:7f00:1::",
  "2002:a9fe:a9fe::",
  "2002:0a00:0005::",
  // Teredo (2001:0::/32): the relay server v4 sits at bytes 4..7 in the clear.
  "2001:0:7f00:1::",
  // Teredo again, this time via the CLIENT field at bytes 12..15, which RFC
  // 4380 stores bitwise-complemented: `5601:5601` is ~(169.254.169.254). The
  // relay server field here is a genuine public v4 (65.54.227.120), so the
  // ONLY thing that can block this address is decoding the client field with
  // the XOR — read it literally and the metadata service walks through.
  "2001:0:4136:e378:0:0:5601:5601",
  // fec0::/10 — site-local. Deprecated, but an on-prem network still numbered
  // in it is reachable by exactly what fc00::/7 exists to block.
  "fec0::1",
  "feff:ffff::1",
  // 100::/64 — RFC 6666 discard-only.
  "100::1",
  "100:0:0:0:ffff:ffff:ffff:ffff",
  // Not an address at all — fail closed.
  "",
  "localhost",
  "not.an.ip",
  "999.999.999.999",
  // Malformed IPv6: unparseable is unclassifiable, and unclassifiable must
  // never mean "safe".
  "1:2:3",
  ":::1",
  "12345::1",
  "::ffff:127.0.0.1:1",
];

const ALLOWED = [
  "1.1.1.1",
  "8.8.8.8",
  "93.184.216.34",
  "100.63.255.255", // just below the CGNAT block
  "100.128.0.1", // just above it
  "172.15.255.255", // just below 172.16/12
  "172.32.0.1", // just above it
  "192.0.1.1", // between 192.0.0/24 and 192.0.2/24
  "192.167.255.255",
  "192.169.0.1",
  "198.17.255.255",
  "198.20.0.1",
  "223.255.255.255", // last address before multicast
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2606:4700:4700:0:0:0:0:1111", // expanded — the fail-closed default must
  // not swallow an address merely because it is spelled out in full.
  "::ffff:8.8.8.8",
  "::ffff:808:808", // the hex spelling of the line above
  "64:ff9b::8.8.8.8", // NAT64 to a public v4 host is a public destination
  // The transition-prefix rules must stay narrow: everything below is global
  // unicast that a real customer endpoint can live at, and each one sits close
  // enough to a blocked prefix that a sloppy mask would swallow it.
  "2001:db8::1", // inside 2001::/16 but NOT Teredo's 2001:0::/32
  "2001:db8:85a3::8a2e:370:7334",
  "2001:ffff::1", // last /32 of 2001::/16 — still not Teredo
  "2002:808:808::1", // 6to4 carrying 8.8.8.8: a public v4 is a public target
  "2003::1", // the /16 immediately above 2002::/16
  "2003:1234:5678::1",
  "2600:1f18::1", // nowhere near 2002::/16, and must stay that way
  "2600::1",
  "100:0:0:1::1", // outside 100::/64 by one bit of the eighth byte
  "101::1", // the /16 above the discard prefix
];

describe("isBlockedAddress", () => {
  it("blocks every internal, reserved or unparseable address", () => {
    for (const ip of BLOCKED) {
      assert.equal(isBlockedAddress(ip), true, `expected blocked: ${ip}`);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ALLOWED) {
      assert.equal(isBlockedAddress(ip), false, `expected allowed: ${ip}`);
    }
  });

  it("gets the boundaries of each range right", () => {
    // One address inside and one immediately outside each CIDR, because an
    // off-by-one in a mask is exactly the mistake that leaves 10.0.0.0/8 open
    // while looking correct in review.
    const pairs: [string, string][] = [
      ["9.255.255.255", "10.0.0.0"],
      ["11.0.0.0", "10.255.255.255"],
      ["126.255.255.255", "127.0.0.0"],
      ["128.0.0.1", "127.255.255.255"],
      ["169.253.255.255", "169.254.0.0"],
      ["169.255.0.1", "169.254.255.255"],
    ];
    for (const [outside, inside] of pairs) {
      assert.equal(isBlockedAddress(outside), false, `outside: ${outside}`);
      assert.equal(isBlockedAddress(inside), true, `inside: ${inside}`);
    }
  });
});

// Testing `isBlockedAddress` alone is what let the original bug ship: the
// fixtures asserted on strings the production caller can never produce,
// because `new URL()` rewrites an IPv4-mapped literal into hex before the
// guard sees it. These cases drive the URL STRING, so the normalization step
// is inside the unit under test and the whole class of bug stays pinned.
//
// No network is involved: a literal address takes the no-DNS branch.
describe("assertDeliverableUrl with a literal IPv6 host", () => {
  const REJECTED = [
    "https://[::ffff:127.0.0.1]/x",
    "https://[::ffff:169.254.169.254]/latest/meta-data/",
    "https://[::ffff:10.0.0.5]/x",
    "https://[::ffff:192.168.0.1]/x",
    "https://[::1]/x",
    "https://[0:0:0:0:0:ffff:127.0.0.1]/x",
    "https://[64:ff9b::127.0.0.1]/x",
    "https://[fe80::1]/x",
    "https://[fd12:3456:789a::1]/x",
    // 6to4 and Teredo: an IPv6 literal whose payload is a v4 destination this
    // server can reach. A subscription pointed at the metadata one has the
    // signed envelope POSTed inward and the response status readable back off
    // the delivery log, which turns the delivery worker into a port scanner.
    "https://[2002:7f00:1::]/x",
    "https://[2002:a9fe:a9fe::]/latest/meta-data/",
    "https://[2002:0a00:0005::]/x",
    "https://[2001:0:7f00:1::]/x",
    "https://[2001:0:4136:e378:0:0:5601:5601]/latest/meta-data/",
    // Site-local and the RFC 6666 discard prefix.
    "https://[fec0::1]/x",
    "https://[100::1]/x",
  ];

  it("refuses an internal address written as an IPv6 literal", async () => {
    for (const raw of REJECTED) {
      await assert.rejects(
        () => assertDeliverableUrl(raw),
        /not reachable from this server/,
        `expected rejected: ${raw} (hostname becomes ${new URL(raw).hostname})`,
      );
    }
  });

  it("still accepts a genuine public IPv6 host", async () => {
    const url = await assertDeliverableUrl("https://[2606:4700:4700::1111]/hook");
    assert.equal(url.hostname, "[2606:4700:4700::1111]");
    assert.equal(url.pathname, "/hook");
  });

  it("does not over-block public addresses near the transition prefixes", async () => {
    // The other half of the 6to4/Teredo/site-local/discard rules: they must
    // catch the embedded-v4 spellings above and nothing else. An SSRF guard
    // that quietly refuses ordinary customer endpoints is a guard people turn
    // off, so the narrowness is asserted, not assumed.
    const ACCEPTED = [
      "https://[2001:db8:85a3::8a2e:370:7334]/hook", // 2001::/16, not Teredo
      "https://[2001:ffff::1]/hook",
      "https://[2002:808:808::1]/hook", // 6to4 carrying the public 8.8.8.8
      "https://[2003:1234:5678::1]/hook", // the /16 just above 2002::/16
      "https://[2600:1f18::1]/hook",
      "https://[100:0:0:1::1]/hook", // one bit outside 100::/64
    ];
    for (const raw of ACCEPTED) {
      const url = await assertDeliverableUrl(raw);
      assert.equal(url.hostname, new URL(raw).hostname, `expected accepted: ${raw}`);
    }
  });
});
