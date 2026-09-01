# Deploying tracktime

Two Coolify apps behind two domains:

| Coolify app | Domain | Compose file | Serves |
|---|---|---|---|
| `tracktime-client` | `https://tracktime.trebeljahr.com` | `docker-compose.client.yml` | the Next web app |
| `tracktime-server` | `https://api.tracktime.trebeljahr.com` | `docker-compose.server.yml` | the Express API, tRPC and the `/ws` socket |

## Why split rather than one app

Coolify's unit of both routing and deployment is the app. Two apps means the
client and the server restart independently, which matters here because the
server holds the WebSocket sync connections — under a single app, every
client-side deploy would drop every connected device's socket for a change
that never touched the server.

It also avoids path-based routing. One domain per service is a mapping with
nothing to get subtly wrong; `/api` + `/ws` + upgrade-header rules on a shared
domain is a configuration that fails quietly when it fails.

The app names are the ones `hatchkit sync` looks for (`<name>-client` /
`<name>-server`), so it can manage the domains once the apps exist. The
service names *inside* each compose file are equally load-bearing: Coolify
keys `docker_compose_domains` by service name, and a key that doesn't match a
service makes Coolify accept the PATCH, emit no Traefik labels, and serve 503.

## One-time setup in Coolify

1. **Databases.** `tracktime-mongo` already exists as a Coolify database.
   Add a Redis one if you want it; the server treats `REDIS_URL` as optional
   and logs "skipping Redis connection" when it is unset.
2. **Two applications**, both from this repo, build pack `dockercompose`:
   - `tracktime-server` → compose path `docker-compose.server.yml`
   - `tracktime-client` → compose path `docker-compose.client.yml`
   The repo is public, so Coolify clones over HTTPS and no GitHub App source
   is needed.
3. **Env on the server app — all of it, in Coolify's env fields.**

   This is the part that does not work the way the rest of hatchkit's docs
   imply. `packages/server/.env.production` is NOT tracked in git here (a
   global gitignore rule for `.env.production` excludes it), and
   `packages/server/Dockerfile`'s runtime stage copies only `dist`,
   `package.json` and `node_modules` — so the encrypted file never reaches
   the image either way, and `DOTENV_PRIVATE_KEY_PRODUCTION` on its own
   decrypts nothing.

   The compose files therefore take every value as a `${VAR}` substitution,
   which Coolify fills from its own env fields. Set at minimum:
   `MONGODB_URI`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`,
   `TRUSTED_ORIGINS`, `S3_PUBLIC_URL`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`.

   `.env.production` remains the local source of truth — it is what
   `NODE_ENV=production pnpm --filter @starter/server start` reads, and where
   to look up the values to paste — but editing it does not change the
   deployment.
4. **DNS**: two A records on `trebeljahr.com`, both to the Coolify server's IP:
   - `tracktime`
   - `api.tracktime`
5. **GitHub secrets** so CI can trigger both deploys:
   `COOLIFY_SERVER_RESOURCE_UUID` and `COOLIFY_CLIENT_RESOURCE_UUID`
   (alongside the existing `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN`). With
   neither set, the workflow falls back to the single `COOLIFY_RESOURCE_UUID`.

Then `hatchkit sync` will push the domains onto both apps.

## What has to agree

The split only works if four things say the same thing, and they are in four
different places:

- `.env.production` — `BETTER_AUTH_URL=https://api.tracktime.trebeljahr.com`,
  `FRONTEND_URL=https://tracktime.trebeljahr.com`. `FRONTEND_URL` is also the
  CORS allow-list entry that lets the client, now on a different host, call
  the API with credentials.
- `.github/workflows/build-and-deploy.yml` — `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_WS_URL` are baked into the browser bundle at image build time.
  Runtime env cannot change them; rebuilding the image is the only way.
- `packages/extension/manifest.config.ts` — the extension's production target
  and its `host_permissions`.
- `packages/raycast/package.json` — the Raycast extension's `apiUrl` /
  `webUrl` preference defaults.

## TRUSTED_ORIGINS

better-auth force-validates the `Origin` header on sign-in whenever a request
carries `Sec-Fetch-*` headers, which every browser fetch does. Any origin that
is not `FRONTEND_URL` needs to be in `TRUSTED_ORIGINS` or sign-in returns
`403 INVALID_ORIGIN` before the password is checked.

Currently set to the production extension's origin. That id is derived from
the directory the unpacked build is loaded from, so it is only right for a
`dist-prod/` at this checkout's path. Before publishing, pin `EXTENSION_KEY`
(see `packages/extension/manifest.config.ts`) so the id stops moving, then:

```bash
pnpm run extension:id prod
pnpm --filter @starter/server exec dotenvx set TRUSTED_ORIGINS "chrome-extension://<id>" -f .env.production
```

## Known-good reference

`playtiao.com` runs this exact topology — two Coolify apps, `playtiao.com` and
`api.playtiao.com` — and both the front page and `api.playtiao.com/api/health`
answer 200. The single-app layout in `docker-compose.yml` is what the sibling
`streaks` deployment uses, and it answers 503.
