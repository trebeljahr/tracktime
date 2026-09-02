#!/usr/bin/env node
// Starts client, server, and (optionally) docs for development.
//
// Every checkout (main, or any git worktree) gets its OWN instance id, which
// isolates the things that used to collide when several copies of this project
// ran at once — a person in their terminal plus any number of agents in their
// own worktrees:
//
//   * ports          — `pnpm dev` pins client, API and docs to the same ports
//                      every run (so password managers, bookmarks and the
//                      clients that bake in the API URL keep working);
//                      `pnpm dev:auto` picks random high ports instead, so
//                      agents never collide with you or with each other
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
//   pnpm run dev                Pinned ports (client 3392, server 5159, docs 4000),
//                               falling back to a random one if any is busy
//   pnpm run dev:auto           Everything auto-picked (agents, worktrees)
//   pnpm run dev:fixed          The same pinned ports, but fail instead of
//                               falling back — and pinned even in a worktree
//   pnpm run dev:docs           Same as dev, plus the docs site
//   pnpm run dev:docs:fixed     Fixed ports with docs
//   node scripts/dev.mjs --dry-run   Resolve and print ports, start nothing

import { execSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { basename, resolve } from "path";
import { extensionOrigin } from "./lib/extension-id.mjs";

const fixedMode = process.argv.includes("--fixed");
const includeDocs = process.argv.includes("--docs");
const autoMode = process.argv.includes("--auto");
// Resolve ports and print the plan without building or starting anything.
const dryRun = process.argv.includes("--dry-run");

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
// `pnpm dev` PINS all three. Every client that is not the web app bakes or
// stores the API origin — the browser extension bakes it at build time, Raycast
// defaults to it, native builds bake it — and a port that moves per run makes
// each of them a copy-paste chore. Password managers, saved logins, bookmarks
// and OAuth redirect allowlists key off the client origin for the same reason.
//
// Agents get `pnpm dev:auto` (automatic in a worktree), which is where random
// ports belong: nothing types those, and several can run at once.
//
// 3392 sits inside the browser-friendly 3000-3999 range while avoiding the
// defaults everything else grabs (3000/3001/3100/3333/...). 5159 and 4000 are
// the API and docs equivalents. Change them here — one number, one place — and
// `packages/extension/manifest.config.ts` plus Raycast's preference defaults
// have to follow.
const DEV_CLIENT_PORT = 3392;
const DEV_API_PORT = 5159;
const DEV_DOCS_PORT = 4000;

// `pnpm dev:auto` — and any pinned port that turns out to be busy — comes out of
// the ephemeral range, which no conventional dev server uses.
const HIGH_PORT_MIN = 49152;
const HIGH_PORT_MAX = 65535;

/**
 * True in a linked worktree. Git points `--git-dir` at
 * `<main>/.git/worktrees/<name>` there while `--git-common-dir` still points at
 * the main `.git`, so the two differ only in a worktree.
 *
 * Worktrees are where agents run, often several at once. They must never fight
 * over the pinned ports, so `pnpm dev` behaves like `pnpm dev:auto` there even
 * if someone forgets the longer command. `--fixed` overrides that, for the case
 * where a worktree is the thing being tested against a baked-in API URL.
 */
function isLinkedWorktree() {
  try {
    const read = (flag) =>
      execSync(`git rev-parse ${flag}`, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    return (
      resolve(repoRoot, read("--git-dir")) !==
      resolve(repoRoot, read("--git-common-dir"))
    );
  } catch {
    return false; // not a git checkout at all — treat it as the main one
  }
}

const inWorktree = isLinkedWorktree();
const autoPorts = autoMode || inWorktree;

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

const claimed = new Set();

async function findRandomFreePort(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = randomInt(HIGH_PORT_MIN, HIGH_PORT_MAX);
    if (claimed.has(port)) continue;
    if (await isPortFree(port)) {
      claimed.add(port);
      return port;
    }
  }
  throw new Error(
    `Could not find a free port in ${HIGH_PORT_MIN}-${HIGH_PORT_MAX} after ${maxAttempts} attempts`,
  );
}

/**
 * An explicit env var wins, then the mode, then the pinned port.
 *
 * A busy pinned port does not block dev: say who to look for and fall back to a
 * random one for this run. `--fixed` is the opposite promise — a caller that
 * asked for exact ports wants to hear that it cannot have them, not to be
 * silently moved somewhere the extension it is testing cannot reach.
 */
async function pickPort(envValue, pinned, label) {
  if (envValue) return parseInt(envValue, 10);
  // --fixed still wins inside a worktree: asking for these exact ports is the
  // one reason to run it there (testing a client that has the API baked in).
  if (autoPorts && !fixedMode) return findRandomFreePort();

  if (await isPortFree(pinned)) {
    claimed.add(pinned);
    return pinned;
  }

  const who = `lsof -nP -iTCP:${pinned} -sTCP:LISTEN`;
  if (fixedMode) {
    console.error(
      `\n  ${label} port ${pinned} is in use, and --fixed means exactly these` +
        `\n  ports. See who has it:  ${who}\n`,
    );
    process.exit(1);
  }

  const fallback = await findRandomFreePort();
  console.warn(
    `\n  ${label} port ${pinned} is already in use — something else is` +
      `\n  listening on it (${who}).` +
      `\n  Using ${fallback} for this run.\n`,
  );
  return fallback;
}

const clientPort = await pickPort(process.env.PORT, DEV_CLIENT_PORT, "Client");
const apiPort = await pickPort(process.env.API_PORT, DEV_API_PORT, "API");
// Only when --docs asked for it: a docs port nobody starts should not warn
// about 4000 being busy, nor fail a --fixed run over it.
const docsPort = includeDocs
  ? await pickPort(process.env.DOCS_PORT, DEV_DOCS_PORT, "Docs")
  : null;

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

// ── Trusted origins ──────────────────────────────────────────────────
//
// The dev browser extension's origin is `chrome-extension://<id>`, and an
// unpacked extension's id is a hash of the absolute path Chrome loaded it from
// — which is THIS checkout's `packages/extension/dist`. So the dev server can
// derive it instead of asking a human to run `pnpm run extension:id` and paste
// the result into an env file; the id is a fact about the path, not a secret.
//
// Only in dev, and only this one id. In production the extension's origin comes
// from a pinned key and belongs in `.env.production`, where it is reviewed —
// nothing here writes to that.
const devExtensionOrigin = extensionOrigin(
  resolve(repoRoot, "packages/extension/dist"),
);
const trustedOrigins = [
  ...(process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  devExtensionOrigin,
];

console.log(`\n  Instance: ${instanceId}`);
const portMode = fixedMode
  ? "pinned ports (--fixed: no fallback)"
  : autoPorts
    ? `auto ports (${autoMode ? "--auto" : "worktree"})`
    : "pinned ports";
console.log(`  Mode:     ${portMode}`);
console.log(`  Client:   http://${WEB_HOST}:${clientPort}`);
if (includeDocs) {
  console.log(`  Docs:     http://${WEB_HOST}:${docsPort}`);
}
console.log(`  Server:   http://${WEB_HOST}:${apiPort}`);
console.log(`  Database: ${mongoUri}`);
console.log(`  Next dir: packages/client/${nextDistDir}`);
console.log(`  Trusts:   ${devExtensionOrigin} (dev extension)\n`);

if (dryRun) process.exit(0);

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
  `TRUSTED_ORIGINS=${trustedOrigins.join(",")}`,
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
