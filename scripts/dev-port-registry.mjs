#!/usr/bin/env node
// A machine-wide registry of stable dev ports, so the checkout you actually
// develop in opens on the SAME localhost port every single time.
//
// Why: password managers, browser profiles, saved bookmarks and OAuth redirect
// allowlists all key off the origin. `http://localhost:51234` changing on every
// `pnpm dev` breaks all of them. A stable port fixes it.
//
// Why a registry and not just a hash: a hash alone can collide with another
// project of yours (or with something else already listening). The registry
// records which absolute path owns which port, so every project on this machine
// gets a port nobody else took — and keeps it forever.
//
//   ~/.config/dev-ports.json          (or $XDG_CONFIG_HOME/dev-ports.json,
//                                      or $DEV_PORT_REGISTRY)
//
//   {
//     "version": 1,
//     "entries": {
//       "/Users/you/projects/tracktime": {
//         "name": "tracktime",
//         "ports": { "client": 3417, "api": 3418 },
//         "updatedAt": "2026-09-01T10:00:00.000Z"
//       }
//     }
//   }
//
// The first port tried for a (path, role) pair is derived from a hash of that
// pair, so a fresh registry on a second machine usually lands on the same port
// as the first. Collisions walk forward from there.
//
// Run this file directly to print the registry:  node scripts/dev-port-registry.mjs

import { createServer } from "net";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
  closeSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

/** Range reserved for "the port a human opens in a browser". */
export const STABLE_PORT_MIN = 3000;
export const STABLE_PORT_MAX = 3999;

// Ports inside the range that are conventionally taken by something else.
// Skipping them up front avoids handing out a port that will collide the first
// time you start an unrelated CRA/Next/Rails app or connect to MySQL.
const AVOID_PORTS = new Set([
  3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, // JS dev servers
  3030, 3100, 3200, 3333, // more JS dev servers / common defaults
  3128, // squid
  3260, // iSCSI
  3306, // MySQL
  3389, // RDP
  3478, // STUN/TURN
  3690, // svn
]);

export function registryPath() {
  if (process.env.DEV_PORT_REGISTRY) return process.env.DEV_PORT_REGISTRY;
  const configHome =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "dev-ports.json");
}

/** Binds the port to find out whether it is genuinely free right now. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

/** Deterministic starting point in [min, max] for a (key, role) pair. */
function preferredPort(key, role, min, max) {
  const hash = createHash("sha256").update(`${key}\0${role}`).digest();
  return min + (hash.readUInt32BE(0) % (max - min + 1));
}

function readRegistry(file) {
  if (!existsSync(file)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.entries) return parsed;
  } catch {
    // Corrupt or half-written. Losing the assignments is survivable — every
    // project just gets re-allocated on its next start — so start clean rather
    // than blocking dev.
  }
  return { version: 1, entries: {} };
}

function writeRegistry(file, registry) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(tmp, file); // atomic on the same filesystem
}

// Two projects starting at the same moment would otherwise read-modify-write
// over each other and both claim the same port. A lockfile is enough here: the
// critical section is a few milliseconds of file IO.
const LOCK_STALE_MS = 10_000;

function acquireLock(file) {
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      closeSync(openSync(lock, "wx")); // fails if it already exists
      return lock;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { force: true }); // owner died mid-write
          continue;
        }
      } catch {
        continue; // lock vanished between the failed create and the stat
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return null; // proceed unlocked rather than refuse to start
}

function releaseLock(lock) {
  if (lock) rmSync(lock, { force: true });
}

/**
 * Reserve a stable port per role for `key`, unique across every path in the
 * registry. Returns `{ ports: { [role]: number }, allocated: string[] }`.
 *
 * @param {object} options
 * @param {string} options.key      Absolute path identifying the checkout.
 * @param {string[]} options.roles  e.g. ["client", "api"] — allocated lazily.
 * @param {string} [options.name]   Human label stored alongside the entry.
 */
export async function reserveStablePorts({ key, roles, name }) {
  const file = registryPath();
  const lock = acquireLock(file);
  try {
    const registry = readRegistry(file);

    let dirty = false;

    // Drop entries for checkouts that no longer exist, so deleted projects and
    // removed worktrees hand their ports back instead of leaking them.
    for (const path of Object.keys(registry.entries)) {
      if (path !== key && !existsSync(path)) {
        delete registry.entries[path];
        dirty = true;
      }
    }

    const takenByOthers = new Set();
    for (const [path, entry] of Object.entries(registry.entries)) {
      if (path === key) continue;
      for (const port of Object.values(entry.ports ?? {})) {
        takenByOthers.add(port);
      }
    }

    const entry = registry.entries[key] ?? { ports: {} };
    const label = name ?? basename(key);
    if (entry.name !== label) {
      entry.name = label;
      dirty = true;
    }
    entry.ports = entry.ports ?? {};

    const ports = {};
    const allocated = [];
    const claimedThisRun = new Set();

    for (const role of roles) {
      const existing = entry.ports[role];
      // Keep what we already own unless another project has since claimed it
      // (possible if two registries were merged, or the file was hand-edited).
      if (
        Number.isInteger(existing) &&
        !takenByOthers.has(existing) &&
        !claimedThisRun.has(existing)
      ) {
        ports[role] = existing;
        claimedThisRun.add(existing);
        continue;
      }

      const port = await findFreeStablePort({
        start: preferredPort(key, role, STABLE_PORT_MIN, STABLE_PORT_MAX),
        skip: (candidate) =>
          takenByOthers.has(candidate) || claimedThisRun.has(candidate),
      });
      ports[role] = port;
      entry.ports[role] = port;
      claimedThisRun.add(port);
      allocated.push(role);
    }

    if (allocated.length > 0) {
      entry.updatedAt = new Date().toISOString();
      dirty = true;
    }
    registry.entries[key] = entry;
    if (dirty) writeRegistry(file, registry);

    return { ports, allocated, file };
  } finally {
    releaseLock(lock);
  }
}

/**
 * Walk forward from `start`, wrapping, for a port that is not reserved by
 * another project, not a well-known default, and not currently listening.
 */
async function findFreeStablePort({ start, skip }) {
  const span = STABLE_PORT_MAX - STABLE_PORT_MIN + 1;
  for (let i = 0; i < span; i++) {
    const port = STABLE_PORT_MIN + ((start - STABLE_PORT_MIN + i) % span);
    if (AVOID_PORTS.has(port)) continue;
    if (skip(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `No free port available in ${STABLE_PORT_MIN}-${STABLE_PORT_MAX}. ` +
      `Free one up, or delete stale entries from ${registryPath()}.`,
  );
}

// `node scripts/dev-port-registry.mjs` — show who owns what.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const file = registryPath();
  const registry = readRegistry(file);
  const entries = Object.entries(registry.entries);
  console.log(`\n  ${file}\n`);
  if (entries.length === 0) {
    console.log("  (no stable ports assigned yet)\n");
  } else {
    for (const [path, entry] of entries.sort((a, b) =>
      (a[1].name ?? "").localeCompare(b[1].name ?? ""),
    )) {
      const ports = Object.entries(entry.ports ?? {})
        .map(([role, port]) => `${role}=${port}`)
        .join("  ");
      console.log(`  ${(entry.name ?? basename(path)).padEnd(24)} ${ports}`);
      console.log(`  ${" ".repeat(24)} ${path}${existsSync(path) ? "" : "  (missing)"}`);
    }
    console.log();
  }
}
