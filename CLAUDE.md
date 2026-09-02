# node-realtime-starter

A stampable starter repo for multiplayer web games and SaaS apps. Express backend, Next.js frontend, MongoDB, tRPC, better-auth, Stripe, WebSocket support.

## Hatchkit Context

This starter is normally generated and maintained by `hatchkit`.
If `.hatchkit.json` exists at the project root, treat the repo as a
Hatchkit-managed project.

Useful Hatchkit commands from inside a generated project:

```bash
hatchkit overview --json                 # inspect manifest/project state
hatchkit update                          # add supported features additively
hatchkit add <project> [services]        # provision GlitchTip/OpenPanel/Plausible/Listmonk+SES/S3/email/search
hatchkit keys push <project>             # push dotenvx private key to Coolify/GitHub Actions
hatchkit sync                            # sync/deploy existing project state
hatchkit rename-domain                   # update domain-related deploy config
hatchkit regen-infra                     # regenerate infra/deploy files
hatchkit provision s3                    # create project buckets + env entries
hatchkit assets pull                     # mirror remote object storage assets locally
```

Newsletter / Listmonk + SES smoke commands (run from the project root
once `hatchkit add <project> listmonk-ses` has populated env):

```bash
pnpm newsletter:verify              # full smoke — API reach, list ids, subscriber, real tx send
pnpm newsletter:test-tx             # send one /api/tx email to LISTMONK_TEST_RECIPIENT
pnpm newsletter:welcome             # send emails/welcome.html to LISTMONK_TEST_RECIPIENT
pnpm newsletter:draft emails/digest-sample.html --subject "Issue 1"   # stage digest as a Listmonk draft
NODE_ENV=production pnpm newsletter:send emails/digest-sample.html --subject "..." --confirm   # real broadcast
```

Hatchkit auto-subscribes your default forwarding email onto
`<project>-test` and writes it to `.env.development` as
`LISTMONK_TEST_RECIPIENT`, so the smoke scripts work end-to-end on a
fresh provision with no extra setup.

Before giving Hatchkit setup advice, run `hatchkit status --json` and
read `providers[]`, `nextStep`, and `suggestions[]`. For provider failures,
run `hatchkit doctor --json` and surface the failing `checks[].hint[]`
lines. Never print dotenvx private keys unless the user specifically asks.

If a Hatchkit command breaks in this project, report the failing command,
cwd, Hatchkit version, output, suspected source area, and safe undo path.
When asking another agent to fix it, include a repair prompt with those details
and tell it to preserve existing user setups, use `--dry-run` where possible,
and ask before provider/DNS/Coolify/Terraform/keychain mutations.

Do not run commands that may alter existing infrastructure unless the user
explicitly asks. Prefer giving the command to the user, or using preview modes
such as `hatchkit destroy <project> --recipe`, `hatchkit gh-pages --undo
--dry-run`, and other command-specific `--dry-run` options.

## Tech Stack

- **Backend:** Express + TypeScript, tRPC for typed API, better-auth for authentication, Stripe for payments
- **Frontend:** Next.js (App Router) + Tailwind CSS + shadcn/ui, tRPC React Query client
- **Database:** MongoDB (Mongoose) + Redis (ioredis)
- **Real-time:** Native `ws` WebSocket on same Express process
- **Monorepo:** pnpm workspaces — `packages/server`, `packages/client`, `packages/shared`

## How to Run

```bash
pnpm install                          # install all dependencies
pnpm run dev:infra                    # start MongoDB, Redis, local S3 (Docker, one-time)
pnpm run seed:assets                  # populate local S3 from seed/assets/ (idempotent)
pnpm run dev                          # start server + client (client on 3392)
pnpm run dev:auto                     # same, but every port auto-picked
pnpm run dev:fixed                    # start on fixed ports (client=6477, server=5159)
```

Two dev commands, because the two callers want opposite things:

- **`pnpm run dev`** serves the client on **port 3392**, hardcoded as
  `DEV_CLIENT_PORT` in `scripts/dev.mjs`. The origin never moves, so password
  managers, saved logins and bookmarks keep working. The API and docs ports are
  still auto-picked from the ephemeral range — nothing types those.
- **`pnpm run dev:auto`** auto-picks every port. Use it for agents and for any
  second instance, so nothing fights over 3392.

`pnpm run dev` inside a git worktree behaves like `dev:auto` automatically, so
several agents can run side by side without stepping on the main checkout.

`PORT`, `API_PORT` and `DOCS_PORT` still pin individual ports, and `--fixed`
wins over all of it. If 3392 is busy, dev warns and falls back to a random port
for that run rather than refusing to start. `node scripts/dev.mjs --dry-run`
resolves and prints ports without starting anything.

Drop fixtures into `seed/assets/` to have them auto-populate the
local bucket — see `seed/README.md`. To copy a real-prod bucket into
local for realistic dev data, `hatchkit assets pull` (treat the copy
as production data — same handling rules apply).

## How to Test

```bash
pnpm run test:unit                    # server unit tests (node:test)
pnpm run test:client                  # client unit tests (Vitest)
pnpm run test:e2e                     # Playwright E2E tests
pnpm run build                        # build all packages
```

## Desktop (Electron or Tauri) + Mobile (Capacitor)

All native targets wrap the Next.js client as a **static export** (`output: "export"`).
The Express server is always remote — the client talks to it over HTTPS.

There are two desktop wrappers — a project has at most one:

- **Electron** (`desktop` feature) — the default for apps.
- **Tauri** (`desktop-tauri` feature) — for games: much smaller binaries,
  Steamworks integration via the Rust side. See `src-tauri/README.md`.

### Desktop (Electron)

```bash
pnpm dev:desktop                      # Next dev + Electron window, HMR recovery
pnpm build:desktop                    # static export + compile electron/
pnpm electron:build                   # electron-builder → dmg/zip/exe/AppImage
pnpm icons:desktop                    # regenerate icns/ico/png set (electron-icon-builder; cross-platform)
```

Replace `build/icon.png` with a 512×512 logo before shipping.
Bundle config lives in root `package.json` `"build"` (electron-builder).
Electron IPC bridge: `electron/preload.ts` exposes `window.electronAPI`.

### Desktop (Tauri + Steamworks)

Requires the Rust toolchain (https://rustup.rs).

```bash
pnpm dev:tauri                        # Next dev + Tauri window, HMR
pnpm build:tauri                      # static export + native bundle (dmg/msi/AppImage)
pnpm icons:tauri                      # regenerate src-tauri/icons/ from build/icon.png
pnpm tauri build -- --features steam  # Steam-enabled build (needs Steamworks SDK redistributable)
```

Bundle config lives in `src-tauri/tauri.conf.json` (strict JSON — no
comments; caveats documented in `src-tauri/README.md`). Steam init is
gated behind the `steam` cargo feature in `src-tauri/src/main.rs` — set
`STEAM_APP_ID` there before shipping.

### Mobile

```bash
pnpm cap:add:ios                      # one-time — requires Xcode
pnpm cap:add:android                  # one-time — requires Android Studio / SDK
pnpm dev:ios                          # live-reload on Simulator
pnpm dev:android                      # live-reload on emulator/device
pnpm build:mobile                     # static export + cap sync
pnpm mobile:assets                    # generate icons/splash from resources/
pnpm build:android:release            # AAB for Play Store
pnpm build:ios:release                # opens Xcode for App Store archive
```

Bridge runs in `packages/client/src/mobile/bridge.ts` — lifecycle, splash,
status bar, orientation. Durable persistence mirror in `durable.ts`.

### Native client auth

Better-auth uses cookies; native shells need extra CORS/trust origins.
Set `TRUSTED_ORIGINS` on the server (comma-separated):

```
TRUSTED_ORIGINS=capacitor://localhost,https://localhost
```

Electron `file://` sends `Origin: null` and can't be trusted with
credentials. Register a custom protocol in `electron/main.ts` and add
it (e.g. `app://-`) instead.

Tauri serves the bundled frontend from `tauri://localhost` (macOS/Linux)
and `http://tauri.localhost` (Windows) — both must be in
`TRUSTED_ORIGINS` for cookie auth to work.

### Clients without a cookie jar (Raycast, CLI, extensions)

There are no API tokens to mint or paste. Every client signs in normally
and keeps the resulting better-auth **session token**, which it sends as
`Authorization: Bearer <token>` (and as the `bearer.<token>` WebSocket
subprotocol). Server side this is the `bearer` plugin in `auth/auth.ts` —
by the time `getSession()` runs, a token client and a cookie client are
indistinguishable, so there is exactly one auth path to reason about.

Use the helpers in `@starter/core` (`session-auth.ts`):

```ts
// Client shows its own sign-in form (browser extension popup):
const { token } = await signInWithPassword(
  { baseUrl, clientId: "tracktime-extension" },
  { email, password },
);

// Client cannot show a form (Raycast, CLI) — RFC 8628 device flow:
const auth = await startDeviceAuthorization({ baseUrl, clientId: "tracktime-raycast" });
// show auth.userCode, open auth.verificationUriComplete
const { token } = await pollForDeviceSession(
  { baseUrl, clientId: "tracktime-raycast" },
  auth.deviceCode,
  { intervalSeconds: auth.intervalSeconds },
);
```

Every such client's **origin must be in `TRUSTED_ORIGINS`**, or sign-in
answers `403 INVALID_ORIGIN` before the password is checked: better-auth force-
validates `Origin` whenever a request carries `Sec-Fetch-*` headers, which every
real browser fetch does (curl does not — which makes curl a misleading way to
test this). An unpacked extension's id comes from the absolute path it was
loaded from; `pnpm run extension:id` prints the origin to add.

Store that token in real secret storage (Keychain, `chrome.storage.session`,
the Raycast password store), never a plain config file. Clients send
`x-tracktime-client` so their session is named in Settings → Devices, where
any of them can be signed out; revocation kills the HTTP and WebSocket paths
at once. Device-flow client ids are allowlisted in `auth/client-label.ts`.

### Tags

Tags are the one catalog dimension outside the Client → Project → Task
hierarchy: many per entry, orthogonal to it, so "invoicing" or "deep work"
can be reported on across every project. Entries carry `tagIds: string[]`.

Three rules that fail quietly if broken:

- **`TimeEntry.tagIds` is never `required`.** Entries written before tags
  existed have no such field, and a required array would fail validation on
  each of them the next time it was saved. (Same trap as
  `TimeEntry.description`, and as `createdBy` on the catalog models.)
- **Deleting a tag `$pull`s it off every entry** — never `$set: []` and never
  `$unset`, either of which takes that entry's *other* tags with it.
- **Tags ride alongside `QuickStart`, never inside `quickStartKey`.** Folding
  them into the key would split one recurring combination into a recent per
  set of labels, so a favorite tagged differently one day fragments the
  recents list. Quick starts therefore open untagged.

`reports.summary` with `groupBy: "tag"` gives an entry's **full** duration to
each of its tags, so the group rows deliberately sum to more than the range
total. Splitting the duration evenly would invent time nobody spent. The
overlap is real, so the table states it on screen rather than showing a
breakdown that cannot reconcile; the report's own totals stay single-counted.

Every client can set tags. The offline payload types in `@starter/core`
(`OfflineStartInput` and friends) carry an optional `tagIds`, so a tag applied
offline survives the replay from the web app, the extension or Raycast alike.
Optional, because a row queued by a build that predates tags must still decode
and replay: the server reads an absent list as "no tags" on start/create and
as "leave them alone" on update.

### Raycast extension

`packages/raycast` is a Raycast extension: a macOS menu bar timer plus
commands to start, stop, toggle, browse and edit entries.

```bash
pnpm dev:raycast                      # builds @starter/core, then `ray develop`
pnpm build:raycast                    # `ray build -e dist`
```

It is a thin shell over `@starter/core` — `createApiClient` for the tRPC
HTTP endpoints, `session-auth.ts` for the device flow, the shared
`formatDuration` helpers for display. Domain logic belongs in `core` so
the browser extension and CLI inherit it; only Raycast UI belongs here.

- Auth: device flow, token in Raycast's encrypted `LocalStorage`, sent as
  `Authorization: Bearer <token>` with `x-tracktime-client: tracktime-raycast`.
- `raycast-env.d.ts` is generated from `package.json` by `ray build` and is
  committed, so `pnpm typecheck` works without Raycast installed.
- Menu bar commands only re-run on their interval (1 min) and when opened, so
  the clock is `h:mm`; mutations call `refreshMenuBar()` to avoid a stale value.
- Server origin and web origin come from extension preferences, defaulting to
  the deployed hosts. Point **API URL** at the dev API port for local work.

### Deployment (two Coolify apps)

Production is a **split**: `tracktime-client` on `https://tracktime.trebeljahr.com`
and `tracktime-server` on `https://api.tracktime.trebeljahr.com`, from
`docker-compose.client.yml` and `docker-compose.server.yml`. The service name
inside each file (`client` / `server`) is load-bearing — Coolify keys
`docker_compose_domains` by it, and a mismatch yields 503 with a 200 from the
API. `docker-compose.yml` is the legacy single-app layout, kept for reference.

Four places must agree on the API host: `.env.production`
(`BETTER_AUTH_URL`), the client image's `NEXT_PUBLIC_API_URL` build arg in
`.github/workflows/build-and-deploy.yml`, `packages/extension/manifest.config.ts`,
and Raycast's preference defaults. See `docs/deploy.md`.

### Browser extension build modes

`packages/extension` bakes its API URL in at build time, so a build is a
target. Both are declared in `packages/extension/manifest.config.ts` — not in
`.env.*`, which is gitignored and would yield a URL-less bundle silently.

```bash
pnpm run build:extension        # dist/      -> http://localhost:5159
pnpm run build:extension:prod   # dist-prod/ -> https://api.tracktime.trebeljahr.com
pnpm run extension:id [dev|prod]  # the chrome-extension:// origin to trust
```

Each target carries its own name and `host_permissions`, so both can be
installed at once and a production build cannot be pointed at localhost. As
unpacked extensions the two have different ids, and **each id's origin must be
in that server's `TRUSTED_ORIGINS`**. Pin `EXTENSION_KEY` to fix the production
id before the server needs to trust it.

### Static export caveats

- `NEXT_PUBLIC_API_URL` is baked at build time — desktop/mobile binaries
  are locked to whichever API URL they were built against. Rebuild to
  retarget.
- No `rewrites()`, no `middleware.ts`, no server components with runtime
  data. Dynamic routes need `generateStaticParams`.
- Next `<Image>` uses the default loader only because `images.unoptimized`
  is set in `next.config.ts`.

## Environment & Secrets (dotenvx)

The server uses **[dotenvx](https://dotenvx.com)** for env handling — a
drop-in replacement for `dotenv` that transparently decrypts values
marked `encrypted:...`. `packages/server/src/config/env.ts` loads
either `.env.production` (when `NODE_ENV=production`) or
`.env.development` (otherwise).

```
packages/server/
  .env.example        plaintext, committed (reference, no real secrets)
  .env.development    plaintext, committed (local-dev defaults, localhost)
  .env.production     mixed: plaintext config + encrypted secrets,
                      committed to git. Public key lives at the top.
  .env.keys           DOTENV_PRIVATE_KEY_PRODUCTION lives here locally;
                      gitignored. In production, set it as an env var
                      instead.
```

### Setting an encrypted value

```bash
pnpm --filter @starter/server exec dotenvx set STRIPE_SECRET_KEY sk_live_... -f .env.production
```

Writes the encrypted ciphertext into `.env.production` and appends
the private key to `.env.keys` if it wasn't there already.

### Running locally against production values

`.env.keys` is read automatically — no extra step:
```bash
NODE_ENV=production pnpm --filter @starter/server start
```

### Deploying to Coolify

The CLI's `devops-cli create` (with `runDeployment: true`) pushes
`DOTENV_PRIVATE_KEY_PRODUCTION` to Coolify's env for you. The
encrypted `.env.production` ships with the repo; Coolify injects the
key at runtime and dotenvx decrypts on load.

### Key rotation

```bash
pnpm --filter @starter/server exec dotenvx rotate -f .env.production
# Then re-deploy so Coolify picks up the new private key.
```

Keep `.env.keys` out of commits. `.gitignore` enforces this.

## Code Style

- TypeScript strict mode everywhere. No `any` — use `unknown` and narrow.
- Prefer `const` over `let`. Never use `var`.
- Named exports only (no default exports except Next.js pages which require them).
- Explicit return types on all public/exported functions.
- Use `@starter/shared` for types shared between client and server.
- Use `@/` path alias for client-side imports within the client package.

## File Organization

```
packages/server/src/
  config/       — environment variables, app config
  db/           — database connections (mongoose, redis)
  models/       — Mongoose schemas and models
  auth/         — better-auth instance and config
  trpc/         — tRPC router, context, procedures
    routers/    — individual tRPC routers (one per domain)
  ws/           — WebSocket handler, room manager, auth
  services/     — external service integrations (Stripe, email, S3)
  middleware/   — Express middleware (error handler, etc.)
  tests/        — server unit tests

packages/client/src/
  app/          — Next.js App Router pages
  lib/          — tRPC client, auth client, utilities
  providers/    — React context providers
  hooks/        — custom React hooks
  components/   — React components
    ui/         — shadcn/ui components
  styles/       — global CSS

packages/shared/src/
  protocol.ts   — WebSocket message types (discriminated unions)
  types.ts      — shared domain types
  schemas.ts    — Zod validation schemas
```

## Critical Middleware Ordering (Express)

The order in `app.ts` is load-bearing. Do not rearrange:

1. `better-auth` handler at `/api/auth/*` — BEFORE express.json (it handles its own body parsing)
2. Stripe webhook at `/api/stripe/webhook` with `express.raw()` — needs raw body for signature verification
3. `express.json()` + `express.urlencoded()` — JSON parsing for everything else
4. `helmet()` — security headers
5. `cors()` — CORS with credentials
6. `morgan()` — HTTP logging
7. tRPC middleware at `/api/trpc`
8. Health endpoint at `/api/health`
9. Error handlers (404 + 500) — must be last

## Environment Variables

- Always add new env vars to `.env.example` with a comment explaining the value
- Add sensible dev defaults to `.env.development` (this file is committed)
- Never commit `.env` or `.env.local` (these are gitignored)
- Server env vars: plain `process.env.X` via `config/env.ts`
- Client env vars: must be prefixed with `NEXT_PUBLIC_` to be available in the browser

## Testing Conventions

- **Server unit tests:** `node:test` module + `assert/strict`. Files in `packages/server/src/tests/*.test.ts`.
- **Client unit tests:** Vitest + @testing-library/react. Files colocated as `*.test.tsx`.
- **E2E tests:** Playwright. Files in `e2e/*.spec.ts`. Helpers in `e2e/helpers.ts`.
- Use `data-testid` attributes for E2E selectors, not CSS classes or text content.

## Commit Messages

Use conventional style: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
Keep the first line under 72 characters. Add a blank line before any body text.

## Branch Naming

`feat/description`, `fix/description`, `refactor/description`.
