# @starter/extension

A popup-only MV3 browser extension for tracktime. The toolbar button opens a
popup that shows the running entry, starts and stops the timer, and reports
today's total. There are no content scripts and nothing is injected into any
page.

## Architecture

The **service worker** (`src/background/`) owns everything stateful: the
session token, the `@starter/core` api-client, the sync WebSocket and the
offline queue. The **popup** (`src/popup/`) is stateless — it sends a message,
receives a full `BackgroundState` snapshot and renders it. Live elapsed
seconds are computed in the popup from `running.start`, so the clock ticks
smoothly even while the worker is asleep.

The message contract lives in `src/lib/messaging.ts`.

## Build and load

```bash
pnpm build:extension          # from the repo root — builds shared, core, then this
pnpm dev:extension            # vite build --watch, for iterating
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `packages/extension/dist`

After a rebuild, hit the reload arrow on the extension card. Changes to the
popup take effect when you reopen it; changes to the service worker need that
reload.

## Pointing it at your dev server

`pnpm run dev` picks a **random API port** on every run, so the URL baked in
at build time (`VITE_API_URL`, defaulting to `http://localhost:5159`) is
almost never the one you want in development. Open the popup, expand the API
URL setting and paste the API URL the dev script printed. It is stored in
`chrome.storage.local` and survives rebuilds.

## Sign-in

Email and password, entered in the popup. The resulting better-auth session
token is kept in `chrome.storage.session` — memory-only, so it never touches
disk and is gone after a browser restart. Signing in again is the intended
cost of that; do not move the token to `chrome.storage.local`.

The session appears in Settings → Devices as `tracktime-extension` and can be
revoked from there, which kills both the HTTP and the WebSocket path.

## Before shipping

`host_permissions` currently includes `https://*/*`, which is far broader than
this extension needs and will draw a review objection on the Chrome Web Store.
It is wide only so a build works against any dev or staging host. Narrow it to
the real API origin (e.g. `https://api.tracktime.example/*`) in
`public/manifest.json` before publishing, and drop the localhost entries from
a production build.

`minimum_chrome_version` is `116` because WebSocket activity only keeps an MV3
service worker alive from that version on, and the sync socket depends on it.

## Safari

Safari supports MV3 web extensions, and this bundle converts:

```bash
xcrun safari-web-extension-converter packages/extension/dist
```

That produces a standalone Xcode project which is **not** wired into this
repo's build — it is a manual, separately maintained step.
