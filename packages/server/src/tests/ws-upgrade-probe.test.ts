import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import {
  revokeStaleSockets,
  sessionWatch,
  setupWebSocket,
} from "../ws/handler.js";
import { SESSION_REVOKED_CLOSE_CODE } from "../ws/session-watch.js";
import type { UpgradeAuth } from "../ws/auth.js";

/**
 * The attachment, which nothing else covers.
 *
 * `ws-session-watch.test.ts` pins what `SessionWatch` does and
 * `ws-revocation.test.ts` pins that the connection handler watches a socket
 * carrying `probeSession` — but both build that socket themselves, so deleting
 * `authedWs.probeSession = () => deps.probe(headers)` from the upgrade path
 * left all twelve of them green with the entire revocation feature inert.
 *
 * This one goes through a REAL handshake against a real HTTP server, so the
 * only thing that can put `probeSession` on the socket is the upgrade path
 * itself. The two auth lookups are injected because the real ones need
 * better-auth and a database; everything else is the shipped code.
 */

const fakeAuth = (userId: string): UpgradeAuth =>
  ({
    session: { user: { id: userId, name: "Probe Tester" } },
    headers: new Headers({ authorization: "Bearer test-token" }),
  }) as unknown as UpgradeAuth;

/** Start a server whose session verdict this test controls. */
const startServer = async (verdict: { value: "live" | "revoked" | "unknown" }) => {
  const server = createServer();
  setupWebSocket(server, {
    authenticate: async () => fakeAuth("user-probe"),
    probe: async () => verdict.value,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port };
};

const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });

test("a socket that completed the upgrade is watched with a working probe", async (t) => {
  const verdict: { value: "live" | "revoked" | "unknown" } = { value: "live" };
  const { server, port } = await startServer(verdict);
  const ws = await connect(port);
  t.after(() => {
    ws.close();
    server.close();
  });

  // The upgrade — not this test — is what put the socket under watch.
  assert.equal(sessionWatch.size, 1, "the upgraded socket was never watched");

  // A live session survives the sweep.
  assert.equal(await revokeStaleSockets(), 0);

  // Revoking it closes the real socket, through the probe the upgrade attached.
  verdict.value = "revoked";
  const closed = new Promise<number>((resolve) =>
    ws.once("close", (code) => resolve(code)),
  );
  assert.equal(await revokeStaleSockets(), 1);
  assert.equal(await closed, SESSION_REVOKED_CLOSE_CODE);
});

test("an unreadable session leaves the socket open", async (t) => {
  const verdict: { value: "live" | "revoked" | "unknown" } = { value: "unknown" };
  const { server, port } = await startServer(verdict);
  const ws = await connect(port);
  t.after(() => {
    ws.close();
    server.close();
  });

  assert.equal(await revokeStaleSockets(), 0, "a database hiccup signed a device out");
  assert.equal(ws.readyState, WebSocket.OPEN);
});
