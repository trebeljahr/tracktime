#!/usr/bin/env node
// Starts client, server, and (optionally) docs for development.
//
// Every checkout (main, or any git worktree) gets its OWN instance id, which
// isolates the things that used to collide when several copies of this project
// ran at once — a person in their terminal plus any number of agents in their
// own worktrees:
//
//   * ports          — random high ports, never the conventional 3000/5000/8080
//   * MongoDB        — a per-instance database, so two checkouts never share or
//                      clobber each other's time entries
//   * host           — one canonical browser host, so CORS and session cookies
//                      work no matter which instance you open
//
// Everything is overridable from the environment when you want two checkouts to
// share (or want a stable setup):
//
//   PORT, API_PORT, DOCS_PORT   pin individual ports
//   INSTANCE_ID                 override the derived id (also names the database)
//   MONGODB_URI                 use one exact database, ignoring the per-instance name
//   MONGO_HOST, MONGO_PORT      point at a MongoDB somewhere other than 127.0.0.1:27017
//   NEXT_DIST_DIR               override the Next.js build directory
//   WEB_HOST                    browser-facing host (default localhost)
//
// Usage:
//   pnpm run dev                Random high ports (client + server)
//   pnpm run dev:fixed          Fixed ports (client 6477, docs 4000, server 5159)
//   pnpm run dev:docs           Random high ports (client + server + docs)
//   pnpm run dev:docs:fixed     Fixed ports with docs

import { createServer } from "net";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename, resolve } from "path";

const fixedMode = process.argv.includes("--fixed");
const includeDocs = process.argv.includes("--docs");

const repoRoot = process.cwd();

// The one host the browser talks to. localhost and 127.0.0.1 are different
// origins AND different sites, so mixing them breaks CORS and stops SameSite=Lax
// session cookies from being sent to the API. Everything browser-facing — the
// printed URLs, the client's API/WS URLs, FRONTEND_URL and BETTER_AUTH_URL —
// therefore uses this single value. Override with WEB_HOST if needed.
const WEB_HOST = process.env.WEB_HOST ?? "localhost";

// ── Instance identity ────────────────────────────────────────────────
//
// Derived from the absolute path of the checkout, so it is stable across
// restarts of the same worktree and distinct between worktrees.

function deriveInstanceId() {
  if (process.env.INSTANCE_ID) return sanitizeId(process.env.INSTANCE_ID);
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 6);
  return sanitizeId(`${basename(repoRoot)}-${hash}`);
}

/** Mongo database names forbid /\. "$*<>:|? and cap at 63 bytes. */
function sanitizeId(raw) {
  return raw
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const instanceId = deriveInstanceId();

// ── Ports ────────────────────────────────────────────────────────────
//
// The dynamic/ephemeral range. Deliberately avoids 3000/4200/5000/5173/8080,
// which are almost always already taken by some other dev server.

const HIGH_PORT_MIN = 49152;
const HIGH_PORT_MAX = 65535;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findRandomFreePort(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = randomInt(HIGH_PORT_MIN, HIGH_PORT_MAX);
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `Could not find a free port in ${HIGH_PORT_MIN}-${HIGH_PORT_MAX} after ${maxAttempts} attempts`,
  );
}

async function pickPort(envValue, fixedValue) {
  if (envValue) return parseInt(envValue, 10);
  if (fixedMode) return fixedValue;
  return findRandomFreePort();
}

const clientPort = await pickPort(process.env.PORT, 6477);
const docsPort = await pickPort(process.env.DOCS_PORT, 4000);
const apiPort = await pickPort(process.env.API_PORT, 5159);

// ── Per-instance database ────────────────────────────────────────────
//
// A literal MONGODB_URI in the environment always wins. Otherwise the URI is
// built here and passed to the server process, where it takes precedence over
// the value in .env.development (dotenvx does not override real env vars).

const mongoHost = process.env.MONGO_HOST ?? "127.0.0.1";
const mongoPort = process.env.MONGO_PORT ?? "27017";
const dbName = `tracktime-dev-${instanceId}`;
const mongoUri =
  process.env.MONGODB_URI ?? `mongodb://${mongoHost}:${mongoPort}/${dbName}`;

// ── Next.js build directory ──────────────────────────────────────────
//
// Defaults to plain `.next`. Separate worktrees are already separate
// directories, so they never share a build cache or the Next 16 dev-server
// lock, and Next rewrites the dist path into the tracked tsconfig.json and
// next-env.d.ts — a per-instance default would leave both files permanently
// dirty and make two instances fight over them.
//
// Set NEXT_DIST_DIR (or INSTANCE_ID) to run two instances from the SAME
// directory; the churn in those two files is the price for that.
const nextDistDir =
  process.env.NEXT_DIST_DIR ??
  (process.env.INSTANCE_ID ? `.next-${instanceId}` : ".next");

// ── Preflight: warn about a dev server already up for THIS checkout ───

// Next 16 writes {pid, port, appUrl} to <distDir>/dev/lock and keeps the dev
// server alive as a detached process, so one can outlive the terminal that
// started it — and then the next run dies with "Another next dev server is
// already running" after tearing everything else down. Detect it up front and
// say exactly what to do.
const lockFile = resolve(repoRoot, "packages/client", nextDistDir, "dev", "lock");
if (existsSync(lockFile)) {
  let lock = null;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    lock = null; // unreadable or partially written — treat as stale
  }

  const pid = Number(lock?.pid);
  let running = false;
  if (Number.isFinite(pid)) {
    try {
      process.kill(pid, 0); // signal 0 = existence check, does not kill
      running = true;
    } catch {
      running = false; // stale lock, process is gone
    }
  }

  if (running) {
    console.error(
      `\n  A Next dev server for this checkout is already running.` +
        `\n    PID:  ${pid}` +
        (lock?.appUrl ? `\n    URL:  ${lock.appUrl}` : "") +
        `\n\n  Reuse it, or stop it with:  kill ${pid}` +
        `\n  Or run a second, independent instance:  INSTANCE_ID=<name> pnpm run dev\n`,
    );
    process.exit(1);
  }
}

console.log(`\n  Instance: ${instanceId}`);
console.log(`  Mode:     ${fixedMode ? "fixed" : "random high ports"}`);
console.log(`  Client:   http://${WEB_HOST}:${clientPort}`);
if (includeDocs) {
  console.log(`  Docs:     http://${WEB_HOST}:${docsPort}`);
}
console.log(`  Server:   http://${WEB_HOST}:${apiPort}`);
console.log(`  Database: ${mongoUri}`);
console.log(`  Next dir: packages/client/${nextDistDir}\n`);

// `@starter/shared` and `@starter/core` resolve through package.json exports to
// dist/. The server and client both consume them, so a fresh checkout with no
// dist/ fails with ERR_MODULE_NOT_FOUND. Build once here, then watch in
// parallel so edits propagate.
console.log("  Building @starter/shared and @starter/core...");
try {
  execSync("pnpm --filter @starter/shared run build", { stdio: "inherit" });
  execSync("pnpm --filter @starter/core run build", { stdio: "inherit" });
} catch {
  process.exit(1);
}

const clientEnv = [
  `PORT=${clientPort}`,
  `NEXT_PUBLIC_API_URL=http://${WEB_HOST}:${apiPort}`,
  `NEXT_PUBLIC_WS_URL=ws://${WEB_HOST}:${apiPort}`,
  `NEXT_DIST_DIR=${nextDistDir}`,
].join(" ");

const serverEnv = [
  `PORT=${apiPort}`,
  `FRONTEND_URL=http://${WEB_HOST}:${clientPort}`,
  `MONGODB_URI=${mongoUri}`,
  `BETTER_AUTH_URL=http://${WEB_HOST}:${apiPort}`,
].join(" ");

const processes = [
  `"pnpm --filter @starter/shared run dev"`,
  `"pnpm --filter @starter/core run dev"`,
  `"node scripts/wait-for-port.mjs ${apiPort} && ${clientEnv} pnpm --filter @starter/client run dev"`,
  `"${serverEnv} pnpm --filter @starter/server run dev"`,
];
const names = ["shared", "core", "client", "server"];
const colors = ["green", "blue", "yellow", "cyan"];

if (includeDocs) {
  processes.push(`"pnpm --filter docs-site run start -- --port ${docsPort}"`);
  names.push("docs");
  colors.push("magenta");
}

// --kill-others-on-fail, NOT -k: a child exiting 0 must not tear down the rest.
// `next dev` in Next 16 can return 0 while the dev server keeps running, and
// with -k that clean exit killed the API server and the tsc watchers with it.
try {
  execSync(
    `npx concurrently --kill-others-on-fail -n ${names.join(",")} -c ${colors.join(",")}` +
      ` ${processes.join(" ")}`,
    { stdio: "inherit" },
  );
} catch {
  process.exit(1);
}
