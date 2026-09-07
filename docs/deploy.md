# Deploying tracktime

Two Coolify apps behind **one** domain:

| Coolify app | Routed at | Compose file | Serves |
|---|---|---|---|
| `tracktime-client` | `https://tracktime.trebeljahr.com` | `docker-compose.client.yml` | the Next web app |
| `tracktime-server` | `https://tracktime.trebeljahr.com/api` | `docker-compose.server.yml` | the Express API, tRPC and the `/api/ws` socket |

## Why one domain and not `api.<domain>`

Because `api.tracktime.trebeljahr.com` cannot get a certificate here.

Cloudflare's Universal SSL certificate for this zone covers `trebeljahr.com`
and `*.trebeljahr.com` — **one** label. `api.tracktime.trebeljahr.com` is two,
so TLS fails before any HTTP happens:

```
$ curl https://api.tracktime.trebeljahr.com/api/health
curl: (35) error:1404B410:SSL routines:ST_CONNECT:sslv3 alert handshake failure
```

`api.playtiao.com` is one label under `playtiao.com`, which is why the sibling
deployment does not hit this and why copying its shape here does not work.

The alternatives were Cloudflare's Advanced Certificate Manager (paid),
turning off the proxy on that record so Coolify issues its own certificate
(exposes the origin IP), or renaming to a single-label host. Serving the API
on a path of the site's own domain costs nothing, needs no second certificate,
and makes the browser client same-origin — so no CORS preflights and no
third-party-cookie exposure for the session cookie.

## Why still two apps

Coolify's unit of deployment is the app. Two apps means the client and the
server restart independently, which matters because the server holds the
WebSocket sync connections — under a single app, every client-side deploy
would drop every connected device's socket for a change that never touched
the server. One domain, two apps, two deploy triggers.

The app names are the ones `hatchkit sync` looks for (`<name>-client` /
`<name>-server`). The service names *inside* each compose file are equally
load-bearing: Coolify keys `docker_compose_domains` by service name, and a key
that doesn't match a service makes Coolify accept the PATCH, emit no Traefik
labels, and serve 503.

## Everything the server owns lives under `/api`

One prefix, one routing rule. The socket included — `resolveSyncUrl`
(`packages/core/src/sync-url.ts`) derives `wss://<domain>/api/ws`, not `/ws`,
so there is no second path to remember at the proxy. A rule nobody remembers
to add is a client that reconnects forever while every HTTP request succeeds.

`packages/server/src/ws/handler.ts` accepts `/ws` as well, so a client built
before this change still connects wherever `/ws` is still routed.

## One-time setup in Coolify

1. **Databases.** `tracktime-mongo` already exists as a Coolify database.
   Add a Redis one if you want it; the server treats `REDIS_URL` as optional
   and logs "skipping Redis connection" when it is unset.
2. **Two applications**, both from this repo, build pack `dockercompose`:
   - `tracktime-server` → compose path `docker-compose.server.yml`,
     domain `https://tracktime.trebeljahr.com/api`
   - `tracktime-client` → compose path `docker-compose.client.yml`,
     domain `https://tracktime.trebeljahr.com`

   Traefik picks the more specific rule first, so the `/api` router wins for
   API traffic and everything else falls through to the client.

   **Check that Coolify did not add a strip-prefix middleware.** Some versions
   attach one automatically to a domain that carries a path. The server mounts
   its routes *at* `/api` — it expects to receive `/api/trpc`, not `/trpc` —
   so a stripped prefix turns every call into a 404 while the site itself
   looks fine. The one-line test is below.
3. **Env on the server app — all of it, in Coolify's env fields.**

   `packages/server/.env.production` is NOT tracked in git here (a global
   gitignore rule for `.env.production` excludes it), and
   `packages/server/Dockerfile`'s runtime stage copies only `dist`,
   `package.json` and `node_modules` — so the encrypted file never reaches
   the image either way, and `DOTENV_PRIVATE_KEY_PRODUCTION` on its own
   decrypts nothing.

   The compose files therefore take every value as a `${VAR}` substitution,
   which Coolify fills from its own env fields. Set at minimum:
   `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`,
   `TRUSTED_ORIGINS`, `S3_PUBLIC_URL`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`.

   `BETTER_AUTH_URL` and `FRONTEND_URL` are now the *same* value,
   `https://tracktime.trebeljahr.com` — that is what one domain means.

   `.env.production` remains the local source of truth — it is what
   `NODE_ENV=production pnpm --filter @starter/server start` reads, and where
   to look up the values to paste — but editing it does not change the
   deployment.
4. **DNS**: one record on `trebeljahr.com` — `tracktime`. There is no longer
   an `api.tracktime` record; delete it if it is still there, so nothing
   resolves to a host with no certificate.
5. **GitHub secrets** so CI can trigger both deploys:
   `COOLIFY_SERVER_RESOURCE_UUID` and `COOLIFY_CLIENT_RESOURCE_UUID`
   (alongside the existing `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN`). With
   neither set, the workflow falls back to the single `COOLIFY_RESOURCE_UUID`.
   All four are already set on this repo.

## Verifying a deploy

```bash
curl -sS https://tracktime.trebeljahr.com/api/health
```

That single call covers the whole chain: the certificate, the `/api` router
winning over the client's, the prefix arriving unstripped, and the server
being up. A 404 with the site otherwise working is the strip-prefix middleware
in step 2. A 503 is Coolify routing with no Traefik labels — check the service
names in the compose files.

## What has to agree

- `.env.production` — `BETTER_AUTH_URL=https://tracktime.trebeljahr.com` and
  `FRONTEND_URL=https://tracktime.trebeljahr.com`. `FRONTEND_URL` is also the
  CORS allow-list entry; same-origin requests do not need it, but the browser
  extension's do.
- `.github/workflows/build-and-deploy.yml` — `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_WS_URL` are baked into the browser bundle at image build time.
  Runtime env cannot change them; rebuilding the image is the only way. Both
  are **origins**, with no `/api` on the end — the client appends the path.
- `packages/extension/manifest.config.ts` — the extension's production target
  and its `host_permissions`.
- `packages/raycast/src/lib/preferences.ts` — the Raycast extension's
  `apiUrl` / `webUrl` defaults (and the placeholders in its `package.json`).

## TRUSTED_ORIGINS

better-auth force-validates the `Origin` header on sign-in whenever a request
carries `Sec-Fetch-*` headers, which every browser fetch does. Any origin that
is not `FRONTEND_URL` needs to be in `TRUSTED_ORIGINS` or sign-in returns
`403 INVALID_ORIGIN` before the password is checked.

The web app is now same-origin with the API, so it needs nothing here. The
browser extension still does. That id is derived from the directory the
unpacked build is loaded from, so it is only right for a `dist-prod/` at this
checkout's path. Before publishing, pin `EXTENSION_KEY` (see
`packages/extension/manifest.config.ts`) so the id stops moving, then:

```bash
pnpm run extension:id prod
pnpm --filter @starter/server exec dotenvx set TRUSTED_ORIGINS "chrome-extension://<id>" -f .env.production
```

Raycast and CLI clients need no origin at all — their `fetch` sends neither
`Origin` nor `Sec-Fetch-*`. The device flow guards them instead.

## The client image serves a static export

`packages/client/next.config.ts` sets `output: "export"`, because the desktop
and mobile shells load the same bundle from `file://` and from the Capacitor
container. So there is no `.next/standalone` and no `server.js`: the image is
the exported `out/` tree plus `packages/client/serve.mjs`, a static file
server. The E2E suite runs that same file (`e2e/serve-static.mjs` delegates to
it), so the deployed server and the tested one cannot drift apart.

`docker-compose.yml` is the legacy single-app layout, kept for reference.
