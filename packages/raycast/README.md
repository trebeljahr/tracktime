# tracktime for Raycast

Start, stop and edit tracktime timers without leaving the keyboard, plus a live
timer in the macOS menu bar.

## Commands

| Command | Mode | What it does |
| --- | --- | --- |
| **Timer** | view | The live one: elapsed time ticking by the second, with stop, edit, refile, pin, discard, favorites and recent work all one keystroke away. |
| **Timer Menu Bar** | menu bar | The same picture at a glance. Stop, edit, move to a project, pin, discard, continue recent work, today's total. |
| **Start Timer** | view | Form for description, project, task and billable. Accepts a description straight from the root search. |
| **Stop Timer** | no-view | Stops the running timer. Made for a global hotkey. |
| **Toggle Timer** | no-view | Stops what is running, or resumes the most recent entry. One hotkey for the whole loop. |
| **Time Entries** | view | Last 14 days grouped by day — continue, edit, delete. |
| **Sign in to tracktime** | view | Pairs this Mac with your account. |

Worth binding to hotkeys: **Toggle Timer** (⌥T works well), **Timer** and
**Start Timer**.

## Setup

1. Run **Sign in to tracktime**. It shows a short code and opens the approval
   page in your browser; confirm the code there while signed in to the web app.
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

### Menu bar refresh, and why there are two Timer commands

Raycast only re-runs a menu bar command on its interval (1 minute here) and when
its dropdown opens, so the clock shows `h:mm` rather than a second-by-second
count that would be wrong most of the time. Commands that change the timer call
`refreshMenuBar()` so the menu bar does not sit on a stale value after a hotkey.

**Timer** is the answer to the other half of that: a view command is on screen,
so it can hold a one-second interval and show a real `0:12:34` that moves, and
it can push a form — which a menu bar item cannot. That is why **Edit Timer…**
in the dropdown hands off to it instead of trying to edit in place. Both read
the same snapshot (`lib/timer-data.ts`), so they can never disagree about what
is running.

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
