# tracktime for Raycast

Start, stop and edit tracktime timers without leaving the keyboard, plus a live
timer in the macOS menu bar.

## Commands

| Command | Mode | What it does |
| --- | --- | --- |
| **Timer** | menu bar | Running timer in the menu bar. Stop, discard, continue recent work, today's total. |
| **Start Timer** | view | Form for description, project, task and billable. Accepts a description straight from the root search. |
| **Stop Timer** | no-view | Stops the running timer. Made for a global hotkey. |
| **Toggle Timer** | no-view | Stops what is running, or resumes the most recent entry. One hotkey for the whole loop. |
| **Time Entries** | view | Last 14 days grouped by day — continue, edit, delete. |
| **Sign in to tracktime** | view | Pairs this Mac with your account. |

Worth binding to hotkeys: **Toggle Timer** (⌥T works well) and **Start Timer**.

## Setup

1. Run **Sign in to tracktime**. It shows a short code and opens the approval
   page in your browser; confirm the code there while signed in to the web app.
2. Set **API URL** and **Web App URL** in the extension preferences if you are
   not on the default deployment (for local dev, the API port `scripts/dev.mjs`
   prints, e.g. `http://127.0.0.1:5159`).

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

### Menu bar refresh

Raycast only re-runs a menu bar command on its interval (1 minute here) and when
its dropdown opens, so the clock shows `h:mm` rather than a second-by-second
count that would be wrong most of the time. Commands that change the timer call
`refreshMenuBar()` so the menu bar does not sit on a stale value after a hotkey.
