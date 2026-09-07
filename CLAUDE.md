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
pnpm run dev                          # client 3392, server 5159, docs 4000
pnpm run dev:auto                     # same, but every port auto-picked
pnpm run dev:fixed                    # the pinned ports, or fail — never a fallback
```

Two dev commands, because the two callers want opposite things:

- **`pnpm run dev`** pins **client 3392, API 5159, docs 4000** (`DEV_*_PORT` in
  `scripts/dev.mjs`). The origins never move, so password managers, saved logins
  and bookmarks keep working — and so do the clients that bake the API URL in at
  build time (browser extension, Raycast, desktop/mobile), none of which can
  follow a port that changes per run.
- **`pnpm run dev:auto`** auto-picks every port. Use it for agents and for any
  second instance, so nothing fights over the pinned three.

`pnpm run dev` inside a git worktree behaves like `dev:auto` automatically, so
several agents can run side by side without stepping on the main checkout. A
worktree therefore does NOT serve the ports the extension and Raycast default
to — point them at the printed ports, or run `dev:fixed` there when the worktree
is the thing being tested.

`PORT`, `API_PORT` and `DOCS_PORT` pin individual ports, and `--fixed` wins over
all of it, worktree included. If a pinned port is busy, `dev` warns and falls
back to a random one for that run rather than refusing to start; `dev:fixed`
exits instead, because "these exact ports" was the point. `node scripts/dev.mjs
--dry-run` resolves and prints ports without starting anything.

`dev` also derives the dev browser extension's `chrome-extension://<id>` origin
from `packages/extension/dist`'s absolute path — the same hash Chrome uses — and
passes it to the server as `TRUSTED_ORIGINS`, so no id is ever pasted by hand
for local work. Anything in `TRUSTED_ORIGINS` in the environment is kept
alongside it. Production origins still belong in `.env.production`.

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

`build/icon.png` is generated — run `pnpm icons:brand` to re-derive it (and
every other shipped bitmap) from `packages/client/public/brand/mark-tile.svg`,
then `pnpm icons:desktop` to fan it out to icns/ico. Do not hand-edit it.
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

A client that runs **in a browser** must have its **origin in
`TRUSTED_ORIGINS`**, or sign-in answers `403 INVALID_ORIGIN` before the password
is checked: better-auth force-validates `Origin` whenever a request carries
`Sec-Fetch-*` headers, which every real browser fetch does (curl does not —
which makes curl a misleading way to test this). An unpacked extension's id
comes from the absolute path it was loaded from; `pnpm run dev` derives it and
trusts it automatically, and `pnpm run extension:id` prints it for any other
server.

Raycast and CLIs need **no origin at all**, and have none to give: their `fetch`
sends neither `Origin` nor `Sec-Fetch-*`, and better-auth's `validateOrigin`
returns early unless the request carries cookies or those headers. What guards
them instead is the device flow — a code the user approves in an already
signed-in browser — plus the client-id allowlist in `auth/client-label.ts` and
per-session revocation in Settings → Devices.

Store that token in real secret storage (Keychain, `chrome.storage.session`,
the Raycast password store), never a plain config file. Clients send
`x-tracktime-client` so their session is named in Settings → Devices, where
any of them can be signed out; revocation kills the HTTP and WebSocket paths
at once. Device-flow client ids are allowlisted in `auth/client-label.ts`.

### Catalog shape

There is one hierarchy, and it is two levels deep: Client → Project. Tasks and
tags sit beside it, not under it.

A **task** is a workspace-wide name for a kind of work — "Design review",
"Invoicing" — and an entry carries a task and a project as two independent
references. Any combination is legal: both, either, neither. Nothing anywhere
infers one from the other, and deleting a project detaches its entries without
touching a single task. Folding tasks under projects meant re-creating
"Design review" once per project and made every cross-project question about
what the work WAS unanswerable.

Three places this used to leak, each of which now deliberately does nothing:

- `entries.start/create/update` validate `projectId` and `taskId`
  independently. There is no "task does not belong to the given project".
- `withProject` in `@starter/core` leaves the task alone. Changing a project
  used to clear the task in the same write.
- `cascadeDeleteProject` deletes no tasks. `CatalogRemoveResult.tasksDeleted`
  survives only for an import undo, which does delete the tasks it created.

Task documents written before this may still carry a stray `projectId`; the
strict mongoose schema drops it on read, so there is nothing to backfill. Task
names are unique per workspace rather than per project, which existing
duplicates across projects are grandfathered past — they only block a new
create or rename.

### Tags

Tags are the other catalog dimension outside the client/project hierarchy:
many per entry rather than one, so "invoicing" or "deep work" can be reported
on across every project. Entries carry `tagIds: string[]`.

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

### Import and export

`data.analyze` / `data.commit` bring a tracked history in from a file, and
`data.exportJson` / `data.exportCsv` take a whole workspace out. Parsing lives
in `packages/server/src/services/import/` and is pure, so it is unit-tested
without a database.

Four rules, each of which fails silently if broken:

- **Column shapes, not vendors.** Headers are matched to roles by an alias
  table (`columns.ts`), and the values decide the granularity: a `Start`
  holding `2026-08-21 09:00` is a `start`, one holding `09:00` is a
  `startTime` needing a `date` beside it. Nothing anywhere names a product.
- **`analyze` and `commit` take the same input and run the same parser.** The
  preview is a description, never a token — the commit re-reads the file
  instead of trusting rows handed back to it, so a tampered preview cannot
  make it write something the user never approved.
- **Day/month order is decided per file, then stated on screen.** `03/04` is
  valid either way round, and a wrong guess moves entries by months without
  ever erroring. Any value over 12 settles it; when nothing does, the preview
  says so and the user picks (`dateOrder`).
- **Every import is a batch.** Entries carry `importId`, so undo is one
  indexed delete; the batch document lists only the catalog it created, which
  is deleted on undo only when nothing else has come to use it. A batch whose
  entries are on an invoice refuses to undo.

Files with a date and a number of hours but no clock time (`date-duration`)
get their entries stacked back-to-back from `IMPORT_DAY_START_HOUR`, in file
order, per day. The times of day are invented — the day totals are not — and
the preview says so rather than letting it pass for recorded fact.

The CSV export is written in the exact column shape the importer recognises,
so a spreadsheet round trip is supported rather than lucky. The JSON export is
the lossless one (colors, archived catalog rows, project rates) and references
the catalog **by name**, so it can be imported into a different workspace or
into an empty one after the database it came from is gone.

### Raycast extension

`packages/raycast` is a Raycast extension with a deliberately small surface —
**five** commands: `menu-bar` (the macOS menu bar timer), `toggle-timer`
("Start / Stop Timer", the `no-view` hotkey), `timer` (the live view that ticks
by the second and is *both* start and stop), `entries` ("Show All Time"), and
`open-dashboard`. Everything else — reports, invoices, the calendar, catalog
curation — is web app work, reached in one keystroke rather than reimplemented
as a launcher command.

Composing an entry is one surface, not three. `components/entry-fields.tsx`
renders the five fields an entry is, and the three forms that write one — start
a timer, log past time (⌘⇧N), edit an entry — all call into it, which is what
keeps a project dropdown grouped by client from being grouped in only one of
them. Two of the three are composers and adopt a project's `billableDefault`;
the editor deliberately does not, because the flag on an existing entry is an
answer somebody already gave and a rate may already be snapshotted from it.

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
- Adding a command is the change to argue about, not adding a feature to one.
  Raycast has no runtime visibility control — `updateCommandMetadata` reaches
  only the *running* command's own subtitle, and background launches are limited
  to `no-view` and menu bar modes — so a "Stop Timer" command is listed whether
  or not anything is running. `timer` therefore adapts on open (Stop is the
  primary action while a timer runs, the start form when none does) and carries
  `keywords` so "start" and "stop" still find it. Continuous state belongs in
  the menu bar, which is the one surface that can hold it.
- `toggle-timer` is the exception, and the mode is the reason: only `no-view`
  and menu bar commands can be launched in the background, so it is the one
  surface a **global hotkey** can drive without opening a window. It stops what
  is running, or continues the newest entry in the same `RECENT_DAYS` window
  the other surfaces call recent, and reports either in a HUD. With nothing to
  resume it launches `timer` rather than starting a nameless entry the user
  then has to fix. Folding it into `timer` costs the hotkey, which is the whole
  point of it — a view command opens a window before it can do anything.
- Pairing has no command: `components/signed-out.tsx` pushes `components/
  sign-in.tsx` from the empty state every view shows while signed out, and
  ⌘⇧A in `timer` reopens it to see the account or sign out. Keep the push —
  `SignIn` opens the approval page in a browser on mount, which is helpful when
  asked for and rude when a list merely failed to load.
- **The description autocomplete is a pushed list, because Raycast has no combo
  box.** A `Form.TextField` cannot offer completions and a `Form.Dropdown`
  cannot accept a name that is not already in it, so ⌘⇧D pushes a searchable
  list of what this person has described work as before — `entries.descriptions`,
  the sibling of `entries.recent`. The two are keyed differently on purpose:
  a recent is keyed on the whole (description, project, task, billable)
  combination and answers "resume this job", a suggestion is keyed on the
  case-folded description alone and answers "you have called work this before".
  One list cannot do both without either repeating a name once per project it
  was ever filed under, or hiding the project it usually belongs to. Searched
  server-side rather than through Raycast's own filtering, because the rows on
  screen are a page out of six months — filtering the page would answer "no
  match" for a description that is certainly there. ⏎ takes the name alone;
  ⌘⇧⏎ takes the project, task, tags and billable flag with it, and is the
  secondary action because overwriting a project the user already picked is the
  destructive reading of "autofill the description".
- **`entries.create` is reachable from Raycast** (⌘⇧N, "Log Past Time"), so the
  meeting you forgot to time no longer needs the web app. Unlike the web
  dialog it does NOT roll a backwards end forward past midnight: that dialog's
  end field holds a time of day with its date coming from a separate control,
  where 23:30 → 00:30 is an hour of work; Raycast's two `DateTime` pickers each
  carry their own date, so a backwards end is a date the user really typed.
- Catalog forms live in `src/components/catalog/` and are pushed from the timer
  and edit forms (⌘⇧P/⌘⇧T/⌘⇧G), each calling back with the created row so the
  picker that opened it can select it. Creating a row mid-timer stays; browsing
  and curating one does not. The color palette
  is `CATALOG_COLORS` in `@starter/shared` — the same list the server assigns
  from and the web picker renders, so a color picked in one client is a color
  the next one can name.
- Raycast unloads a menu bar command once its first render settles, so a
  `setInterval` in it fires once and stops. An unfinished load is the one thing
  that keeps the process alive: the item passes `isLoading` while a timer runs,
  which is what lets the clock tick `m:ss` every second, and drops it when the
  timer stops so an idle item costs nothing. `interval` (1m) and the dropdown
  opening cover the unloaded case. Staying loaded means owning freshness:
  `entries.current` every 4s while ticking, because a stop made elsewhere would
  leave a clock counting up on an ended entry, and the whole snapshot every
  20s; mutations call `refreshMenuBar()` rather than waiting for either. Idle
  and running are separate preferences: `idleTitle` (bare mark by default,
  "Start timer", or the total) and `titleMode` (how much of a running timer).
  A total shown idle is `36m`, never `0:36` — the running clock owns the
  colon, and a total that borrowed it was read as a timer still going. The `Timer` view
  command is the surface that can push forms, which a menu bar item cannot.
  Both read `lib/timer-data.ts`, so the two surfaces cannot disagree about what
  is running.
- **`refreshMenuBar()` is a nudge, never the mechanism.** It is a background
  `launchCommand`, and Raycast may decline it — and a menu bar command that is
  still *loaded*, which is exactly what a running timer keeps it, is not
  remounted by one. On its own it left the item ticking an entry the user had
  just stopped from the `timer` command one process over. Four things carry the
  truth instead, in descending order of how quickly they notice and ascending
  order of how much they cost:
  - **The timer echo** (`timer-echo.ts` in `@starter/core`, `lib/storage.ts`
    here) — every timer mutation records `{ runningId, at }` in Raycast's
    `LocalStorage` the instant the server confirms it, written centrally in
    `api.ts` so a new command cannot forget. Any surface re-reads it once a
    second — a local read, no network — and `reconcileRunning` lets it outrank
    a snapshot *fetched before it*. This is the one that closes the gap
    between Raycast's separate command processes, and the only one that still
    works with the network down. It needs no TTL: the next successful fetch
    carries a later `fetchedAt`, so a stale record of a stop can never mask a
    timer started on another device.
  - **The sync socket** (`lib/sync.ts`) — held for as long as Raycast keeps a
    command alive, which is a view command while it is open and the menu bar
    item while it ticks. That is what makes a stop from the web app or another
    machine land at once rather than on a poll. It deliberately does NOT
    filter this install's own `originId`: every Raycast command shares one, so
    filtering would drop the event the menu bar needs most.
  - **`useWatchRunning`** — `entries.current` every 4s, but only while the
    socket is NOT connected. An open socket has already reported every stop,
    so polling underneath it asks a question that has been answered.
  - **`usePoll`** — the whole snapshot every 20s, which is also what picks up
    a renamed project or a new favorite.
- `entries.stop` is **idempotent when given an id**: an entry that is already
  stopped is returned rather than refused. Two devices racing to stop one timer
  is the normal case, and the loser asked for a state the world is already in.
  Without an id there is nothing to be idempotent about, so "nothing running"
  stays a 404 — which the clients read via `isAlreadyStopped` and report as
  success, because the user got what they wanted.
- Server origin and web origin come from extension preferences. Empty follows
  the build, the same convention as the browser extension's build targets:
  `ray build` → the deployed hosts, `ray develop` → `localhost:5159` /
  `localhost:3392`, the ports `pnpm run dev` pins. Neither preference
  carries a `default` in `package.json`, because a default there is stored as a
  real value and "untouched" would be indistinguishable from "typed the
  production URL". A worktree runs on random ports — set both by hand there.

### Deployment (two Coolify apps, one domain)

Production is two apps behind **one** domain: `tracktime-client` on
`https://tracktime.trebeljahr.com` and `tracktime-server` on
`https://tracktime.trebeljahr.com/api`, from `docker-compose.client.yml` and
`docker-compose.server.yml`. The service name inside each file (`client` /
`server`) is load-bearing — Coolify keys `docker_compose_domains` by it, and a
mismatch yields 503 with a 200 from the API. `docker-compose.yml` is the
legacy single-app layout, kept for reference.

The API is on a **path**, not on `api.<domain>`, because Cloudflare's
Universal SSL for this zone covers `trebeljahr.com` and `*.trebeljahr.com` —
one label. `api.tracktime.trebeljahr.com` is two, so it got no certificate and
failed the TLS handshake before any HTTP. Two apps rather than one so a client
deploy cannot restart the server and drop every connected device's socket.

Everything the server owns lives under `/api`, the socket included:
`resolveSyncUrl` derives `wss://<domain>/api/ws`, so one proxy rule covers the
lot. `NEXT_PUBLIC_API_URL` is an **origin** with no path — the clients append
`/api/trpc`, `/api/auth` and `/api/ws` themselves.

Four places must agree on it: `.env.production` (`BETTER_AUTH_URL`), the
client image's `NEXT_PUBLIC_API_URL` build arg in
`.github/workflows/build-and-deploy.yml`, `packages/extension/manifest.config.ts`,
and `packages/raycast/src/lib/preferences.ts`. See `docs/deploy.md`.

The client image serves the static export: `output: "export"` leaves no
`.next/standalone`, so the image is `out/` plus `packages/client/serve.mjs`.
The E2E suite runs that same file, so the deployed and tested servers cannot
drift apart.

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
in that server's `TRUSTED_ORIGINS`**. The dev id is derived and trusted by
`pnpm run dev` (`scripts/lib/extension-id.mjs`, shared with `extension:id` so
the two can never disagree). The production id has to be pinned with
`EXTENSION_KEY` and added to `.env.production` by hand — deliberately: a
production trust list that a script can extend is a trust list nobody reviews.

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
