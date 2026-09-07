# tracktime for Raycast

Start, stop and edit tracktime timers without leaving the keyboard, plus a live
timer in the macOS menu bar.

## Commands

Four, on purpose. Everything else tracktime can do is better done in the web
app, and a launcher that lists twelve of its own commands is a launcher you
have to search inside of.

| Command | Mode | What it does |
| --- | --- | --- |
| **Timer** | view | Start and stop. Running: the elapsed time ticking by the second, with stop, edit, refile, pin and discard. Idle: the start form, favorites and recent work. |
| **Timer Menu Bar** | menu bar | The same picture at a glance, with the clock ticking by the second while a timer runs. Stop, edit, move to a project, pin, discard, continue recent work, today's total. |
| **Show All Time** | view | Last 14 days grouped by day — continue, edit, delete. |
| **Open Dashboard** | no-view | Jumps to the web app. |

Bind **Timer** to a hotkey (⌥T works well) and it is the whole loop: press it,
and ⏎ either stops what is running or opens the start form.

### Why start and stop are not two commands

Raycast cannot hide a command based on state. `updateCommandMetadata` reaches
only the subtitle of the command that is currently running, and background
launches are limited to `no-view` and menu bar commands, so nothing can keep a
view command's root-search row in sync with a timer that started elsewhere. A
**Stop Timer** row that is listed while nothing runs is not a smaller surface
than one command that knows which it is.

So the state lives where it can be true continuously — the menu bar — and
**Timer** adapts on open: its primary action is Stop while a timer runs, and
the start form when none does. `keywords` in the manifest keep it findable by
typing "start" or "stop".

### Creating catalog rows

Clients, projects, tasks and tags are creatable and editable here, but only
where you are already standing: the start form and **Edit Entry** carry ⌘⇧P
(new project), ⌘⇧T (new task) and ⌘⇧G (new tag), and come back with the new row
already selected; the project form has ⌘⇧C for a new client. Nothing typed is
lost on the detour.

There is deliberately no Projects, Clients or Tags command. Browsing and
curating a catalog — renaming, archiving, deleting, reordering, colors, rates,
budgets — is web app work, and **Open Dashboard** is one keystroke away.
Creating a row mid-timer is not: stopping to go to the browser is exactly the
interruption the extension exists to avoid.

## Setup

0. Install it: `pnpm build:raycast` from the repo root. `pnpm dev:raycast`
   installs the extension too, but that build is only as fresh as the last
   `ray develop` session — leave it at that and the menu bar item eventually
   belongs to a build nobody is running any more, which looks exactly like the
   feature not existing. Build once and the item is simply there, at login,
   without opening Raycast: a menu bar command needs no launch, only the
   command left enabled (Raycast Settings → Extensions → tracktime).
1. Run **Timer**. Signed out it offers **Sign in to tracktime**: ⏎ shows a
   short code and opens the approval page in your browser; confirm the code
   there while signed in to the web app. (Pairing has no command of its own —
   it is the wall every command hits, so it lives where you hit it. ⌘⇧A in
   **Timer** reopens it later to see the account or sign out.)
2. Set **API URL** and **Web App URL** in the extension preferences only if you
   are not on the default deployment. Leaving them empty follows the build: a
   `ray build` bundle talks to the deployed hosts, a `ray develop` one talks to
   `http://localhost:5159` / `http://localhost:3392` — the ports `pnpm run dev`
   pins. (A git worktree runs on random ports; set the preferences for that.)

There is no API key to mint or paste. Raycast signs in through the RFC 8628
device flow and keeps the resulting better-auth **session token** in Raycast's
encrypted `LocalStorage`, sending it as `Authorization: Bearer <token>`. The
session shows up as **Raycast** under Settings → Devices in the web app, and
signing it out there kills this extension's access immediately.

## Development

```bash
pnpm --filter @starter/core run build   # the extension imports the built dist
pnpm --filter tracktime-raycast run dev # ray develop, hot reloads into Raycast
```

```bash
pnpm --filter tracktime-raycast run build
```

The extension is a thin shell over [`@starter/core`](../core): API calls go
through `createApiClient`, auth through `session-auth.ts`, durations through the
same `formatDuration` helpers the web app uses. Nothing about the tracktime
domain should be reimplemented here — if a helper is missing, add it to
`@starter/core` so the browser extension and CLI get it too.

`raycast-env.d.ts` is generated from `package.json` by `ray build`, and is
committed so `pnpm typecheck` works on machines without Raycast installed.

### Menu bar refresh, and why the menu bar is a second surface

Raycast unloads a menu bar command as soon as its first render settles: a
`setInterval` in the component fires once and never again, and the item then
sits on whatever it last drew until the interval (30 seconds here) or an open
dropdown re-runs it. What keeps the process alive is an unfinished load, so the
item passes `isLoading` for exactly as long as it has a second to count — a
running timer ticks `m:ss` off its own clock, and an idle one stops claiming to
load and is unloaded like any other command. The `tickSeconds` preference turns
that off for anyone who would rather have the process gone.

Alive, the command also re-reads the server every 20 seconds, which is how a
timer started in the web app or on another machine reaches the menu bar.
Commands that change the timer themselves call `refreshMenuBar()` instead of
waiting for that, so a hotkey lands immediately.

**Timer** remains the richer surface: a view command can push a form, which a
menu bar item cannot. That is why **Edit Timer…** in the dropdown hands off to
it instead of trying to edit in place. Both read the same snapshot
(`lib/timer-data.ts`), so they can never disagree about what is running.

## Troubleshooting

**"Could not pair — fetch failed"** — the extension is talking to a server that
is not there. The pairing screen shows which URL it tried; ⏎ on **Open
Extension Preferences** and fix **API URL**. The defaults point at the deployed
hosts, so a local-only setup has to be pointed at the dev ports.

**Nothing in the menu bar** — three things hide it, in this order:

1. A Raycast menu bar command only appears after it has been run once. Open
   Raycast, run **Timer Menu Bar**, and the item shows up; it then refreshes on
   its own every minute.
2. The **Idle** preference ("Hide the menu bar item when no timer runs") does
   exactly that — with nothing running there is nothing in the menu bar until
   the next start.
3. With no timer running the item shows today's total rather than a clock, so
   look for a small `0:00` next to the stopwatch, not a running time.

**Seeing what went wrong** — the terminal running `pnpm dev:raycast` is the
extension's console: `console.log` and stack traces print there. View commands
also render errors inline, and Raycast Settings → Extensions → tracktime lists
every command with its hotkey and preferences.

**Local dev URLs** — `pnpm dev` prints the API and client ports it picked (pin
them with `API_PORT=5159 pnpm dev`). API URL is the server port, Web App URL is
the client port; the device flow bounces through the web app, so you must be
signed in there in a browser before approving the code.
