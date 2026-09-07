# Contributing to tracktime

Thanks for taking the time to look at this. tracktime is time tracking with
clients, projects, tasks, tags and billable rates — a web app plus a browser
extension and a Raycast extension that share one backend.

Contributions are welcome in three shapes:

- **Bug reports.** Open an issue with the
  [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml). Reproduction steps
  and which client surface you saw it on (web, extension, Raycast, server) are
  what make a report actionable.
- **Features.** Open a
  [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) *before* writing
  code for anything non-trivial. This is a small project with an opinionated
  scope, and it is better to hear "out of scope" in an issue than in a pull
  request you already wrote.
- **Documentation.** Corrections to the README, this file, `docs/`, or
  `docs-site/` are welcome without a preceding issue.

Everyone participating is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

---

## Development setup

### Prerequisites

| Requirement | Version | Where it is pinned |
|---|---|---|
| Node.js | 24 | `.nvmrc`; `engines.node` in `package.json` is `>=24` |
| pnpm | 11.1.2 | `packageManager` in `package.json` |
| Docker | any recent | runs MongoDB, Redis and an S3-compatible store for local dev |

Enable pnpm through corepack rather than installing it globally, so the pinned
version in `packageManager` is the one you get:

```bash
corepack enable
nvm install && nvm use     # or your Node version manager of choice
```

### First run

```bash
git clone https://github.com/trebeljahr/tracktime.git
cd tracktime
pnpm install
```

The server reads `packages/server/.env.development`, which is **not** in the
repository — only `.env.example` is. Copy it:

```bash
cp packages/server/.env.example packages/server/.env.development
```

Then set `BETTER_AUTH_SECRET` in that file to any random string of 32+
characters. `packages/server/src/config/env.ts` only throws on missing required
values when `NODE_ENV=production`, so in development an empty signing secret
fails later and less clearly — set it now.

You can leave `FRONTEND_URL`, `BETTER_AUTH_URL`, `MONGODB_URI`, `PORT` and
`TRUSTED_ORIGINS` alone: `scripts/dev.mjs` passes all five to the server as real
process environment, which takes precedence over the file.

### Start the services and the app

```bash
pnpm run dev:infra    # docker compose -f docker-compose.dev.yml up -d
                      # mongo:7 on 27017, redis:7-alpine on 6379,
                      # seaweedfs S3 on 9000 (bucket tracktime-dev)
pnpm run dev          # client 3392, API 5159
```

Open <http://localhost:3392>.

Variants of the dev command, all in `scripts/dev.mjs`:

| Command | Ports |
|---|---|
| `pnpm run dev` | pinned: client 3392, API 5159 — falls back to a random port if one is busy |
| `pnpm run dev:auto` | every port auto-picked in 49152–65535; use this for a second instance |
| `pnpm run dev:fixed` | the pinned ports or exit — never a fallback |
| `pnpm run dev:docs` | as above, plus the Docusaurus site on 4000 |
| `node scripts/dev.mjs --dry-run` | prints the resolved ports and starts nothing |

Two gotchas worth knowing up front:

- **Inside a git worktree, `pnpm run dev` behaves like `dev:auto`** so several
  checkouts can run side by side. Anything with a baked-in API URL — the browser
  extension, the Raycast preference defaults — will not find the server there.
  Use `pnpm run dev:fixed` in a worktree when that matters.
- `pnpm run seed:assets`, `assets:push` and `assets:pull` shell out to a private
  CLI that is not installable from this repository. Nothing about running or
  testing the app depends on them — skip them.

Stop the containers with `pnpm run dev:infra:stop`, or wipe their volumes with
`pnpm run dev:infra:reset`.

---

## Repository layout

```
packages/
  server/      Express 5 + tRPC + better-auth + Mongoose + ws
    src/config/      environment and app config
    src/models/      Mongoose schemas
    src/auth/        better-auth instance, workspace resolution
    src/trpc/        router, context, procedures
      routers/       one router per domain
    src/ws/          WebSocket handler, rooms, sync fan-out
    src/services/    imports, PDF, CSV, newsletter, storage
    src/tests/       node:test unit tests
  client/      Next.js App Router (static export) + Tailwind + shadcn/ui
    src/app/         routes
    src/components/  React components (ui/ is shadcn)
    src/hooks/       custom hooks
    src/lib/         tRPC client, auth client, utilities
  shared/      types, zod schemas, WS protocol, and pure domain logic
               (durations, timezones, timesheet rules, budgets, imports)
  core/        client-agnostic runtime shared by web, extension and Raycast
               (api client, device-flow auth, offline queue, idle, sync)
  extension/   Chrome MV3 browser extension (popup only)
  raycast/     Raycast extension — menu bar timer, commands, catalog CRUD

e2e/           Playwright specs and their harness
docs/          deploy.md, dev-setup.md
docs-site/     Docusaurus site (not currently deployed)
scripts/       dev orchestration, extension id, icon and newsletter scripts
electron/      Electron main + preload for the desktop wrapper
```

Domain logic that more than one client needs belongs in `packages/shared` (types
and pure rules) or `packages/core` (runtime behaviour). Only UI belongs in the
extension and Raycast packages.

---

## Tests and checks

| Command | What it covers |
|---|---|
| `pnpm run test:unit` | Server unit tests — `node:test` over `packages/server/src/tests/*.test.ts`. Pure logic: budgets, CSV, PDF, import parsing, invoicing guards, timesheet rules, runaway timers, workspace scoping, schemas. No MongoDB, Redis or Docker needed. |
| `pnpm run test:client` | Client unit tests — Vitest + `@testing-library/react` over colocated `*.test.ts(x)` files under `packages/client/src`. jsdom; no services needed. |
| `pnpm run test:e2e` | Playwright, chromium, serial. Specs in `e2e/`. **Needs Docker** — `e2e/start-server.sh` starts its own Mongo, Redis and S3 containers on separate ports, and the suite runs against the client's static export, so the first run includes a full build. |
| `pnpm run build` | Full production build in dependency order: shared → core → server → client. |
| `pnpm run typecheck` | Builds shared + core (they resolve through `package.json` exports to `dist/`), then `tsc --noEmit` across every other package, plus the Electron main process. |
| `pnpm --filter @starter/client run lint` | ESLint over the client package. There is no root `lint` script. |
| `pnpm test` | All three test commands in sequence. |

**A pull request should pass `pnpm run build`, `pnpm run test:unit` and
`pnpm run test:client`.** Run `pnpm run typecheck` too — it is cheap and catches
things the builds do not.

E2E is the awkward one and we do not require it from contributors. It needs
Docker, it takes minutes because of the client build, and its ports and database
are not isolated by default — if you run it while another checkout is running,
pass your own `E2E_SERVER_PORT`, `E2E_CLIENT_PORT` and `MONGODB_URI` or you will
be testing the other checkout's build. Note also that CI's E2E job is not
currently green; see [PR process](#pull-request-process).

---

## Code style

These are the rules the existing code follows. They are not negotiable style
preferences so much as the things that keep the four clients able to share code.

- **TypeScript strict mode everywhere.** No `any` — take `unknown` and narrow it.
- **`const` over `let`.** Never `var`.
- **Named exports only**, except Next.js pages, which require a default export.
- **Explicit return types on all exported functions.**
- **`@starter/shared` for types that cross the client/server boundary.** A type
  defined twice drifts.
- **`@/` path alias** for client-side imports within `packages/client`.

Two things that fail quietly if you get them wrong:

- **The Express middleware order in `packages/server/src/app.ts` is
  load-bearing. Do not rearrange it.** better-auth must be mounted before
  `express.json()` because it parses its own body; the Stripe webhook slot needs
  the raw body for signature verification; the error handlers must be last. The
  file documents the order — read the comments before touching it.
- **E2E selectors use `data-testid` attributes**, not CSS classes or visible
  text. If you add UI that a spec needs to reach, add the test id.

Testing conventions by package: `node:test` + `assert/strict` for the server
(`packages/server/src/tests/*.test.ts`), Vitest + testing-library colocated
alongside the component for the client, Playwright in `e2e/*.spec.ts` with
helpers in `e2e/helpers.ts`.

---

## Commit messages and branches

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: import history from a file
fix: keep tag ids when an offline start replays
refactor: move duration formatting into shared
test: cover the midnight-crossing timesheet cell
docs: document the device flow for tokenless clients
chore: bump playwright
```

- Prefixes in use: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Keep the first line under 72 characters.
- Blank line before any body text. Use the body for *why*, not *what* — the
  diff already says what.

Branch names: `feat/short-description`, `fix/short-description`,
`refactor/short-description`.

---

## Developer Certificate of Origin (DCO)

**This project uses the DCO, not a CLA.** You keep the copyright in everything
you contribute. There is no agreement assigning your work to anyone, and no
form to sign. What the DCO asks is a statement, attached to each commit, that
you have the right to submit the code under the project's licence — see
[LICENSE](LICENSE) — and that you are happy for it to be distributed under that
licence.

The statement is the full text of
[Developer Certificate of Origin 1.1](https://developercertificate.org/), and
you make it by adding a `Signed-off-by` trailer to the commit message:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The name and email must match the commit author. Git will add the trailer from
your configured `user.name` and `user.email` when you pass `-s`:

```bash
git commit -s -m "fix: keep tag ids when an offline start replays"
```

Set those once if you have not:

```bash
git config user.name "Jane Doe"
git config user.email "jane@example.com"
```

### Fixing commits you already made

Forgot the sign-off on your last commit:

```bash
git commit --amend -s --no-edit
```

Forgot it across a whole branch:

```bash
git rebase --signoff main
```

Both rewrite history, so force-push the branch afterwards
(`git push --force-with-lease`). If your pull request is already open, that is
fine — the DCO check re-runs on the updated commits.

CI verifies that every non-merge commit in a pull request carries a
`Signed-off-by` trailer. A trailer under a different identity than the commit
author (a work address, GitHub's noreply form) is accepted — the log notes it,
the job does not fail. A missing trailer does fail the job, and the pull request
will not merge until it is fixed.

---

## Pull request process

1. **Fork the repository** and branch off `main` using the naming above.
2. **Keep the pull request focused.** One concern per PR. A refactor bundled
   with a behaviour change is much harder to review, and much harder to revert
   if it turns out to be wrong. Split them.
3. **Discuss features in an issue first.** Bug fixes and doc corrections can go
   straight to a PR.
4. **Run the checks locally** — `pnpm run build`, `pnpm run test:unit`,
   `pnpm run test:client`, `pnpm run typecheck`.
5. **Update the docs when behaviour changes.** `CLAUDE.md` at the repository
   root is the most accurate description of how the system actually works and is
   kept current; if your change makes a statement in it wrong, fix the statement
   in the same PR.
6. **Sign off your commits** (see above).
7. **Fill in the pull request template** — what changed, why, how you tested it.

### What CI runs

`.github/workflows/build-and-deploy.yml` runs on pushes to `main` and on pull
requests, but the two do very different things.

On a **push to `main`** it runs `pnpm install --frozen-lockfile`,
`pnpm run build`, `pnpm run test:unit` and `pnpm run test:client`, then a
Playwright E2E job, then builds and publishes the two Docker images and deploys
them.

On a **pull request** every one of those jobs is skipped
(`if: github.event_name == 'push'`, so a PR can reach neither the `ghcr.io`
push nor the deploy API). The only job that runs is `dco`, in that same
workflow file.

Two honest caveats about the state of CI, so nothing surprises you:

- The E2E job is not currently passing on `main`. If your PR is otherwise sound,
  an E2E failure that reproduces on `main` is not yours to fix — say so in the
  PR and we will sort it out separately.
- The Docker image build jobs are gated behind the E2E job and have therefore
  never actually run. The `packages/client/Dockerfile` path in particular is
  unverified.

---

## Security

Please do not open a public issue for a security problem. Email
<ricotrebeljahr@gmail.com> instead. See [SECURITY.md](SECURITY.md) if present.

## Questions

Open a [discussion or an issue](https://github.com/trebeljahr/tracktime/issues),
or email <ricotrebeljahr@gmail.com>. The hosted app is at
<https://tracktime.trebeljahr.com>, its API at
<https://api.tracktime.trebeljahr.com>.
