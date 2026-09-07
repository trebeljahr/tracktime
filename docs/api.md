# The public REST API

`/api/v1` is the token-authenticated REST surface third parties integrate against.
Everything an integrator needs is on the docs site (`docs-site/docs/api/`); this
file is for whoever maintains the thing.

The user-facing pages are: overview, authentication, errors, rate-limits,
reference (generated), webhooks.

## The one architectural rule

**REST never enters tRPC.** A token request authenticates in
`packages/server/src/api/v1/auth.ts`, builds a `WorkspaceScope`, and calls the same
extracted service functions the tRPC resolvers call. There is no synthetic tRPC
context, no token path through `workspaceProcedure`, and no `AuthMethod` for it.

That is what makes "a token can never address a workspace of its own choosing"
structural rather than a rule every handler has to remember: a token request never
reaches `workspaceIdFromInput`, because it never reaches the tRPC context at all. The
`workspaceId` scrub in `requireApiToken` is belt-and-braces on top, not the guarantee.

Because the two surfaces share the services, a REST write publishes the same sync
event and enqueues the same webhook deliveries as the equivalent tRPC call. Nothing
in `api/v1/` re-implements a business rule; a handler that does is a bug.

## One table, two artifacts

`packages/server/src/api/v1/routes-table.ts` holds `API_ROUTES`. Express mounts from
it (`index.ts`), and the OpenAPI document is generated from it (`openapi.ts`) using
zod 4's native `z.toJSONSchema(schema, { target: "draft-2020-12" })` over the SAME
shared schemas the handlers validate with. There is no zod-to-openapi dependency and
there must not be one.

So a route cannot exist undocumented — nothing is mounted that is not in the table —
and cannot be documented but unimplemented: `mount()` throws at boot when a listed
route has no handler. A boot failure is noticed; a documented endpoint that 404s is
not.

Adding a route means adding a row, a handler under `api/v1/routes/`, its scope in
`tests/rest-openapi.test.ts` (written out, so widening one is a deliberate edit), and
re-running the emitter:

```bash
pnpm run openapi:emit
```

That writes two COMMITTED files:

- `docs-site/static/openapi.json` — the spec the docs site serves.
- `docs-site/docs/api/reference.md` — the route table page.

Committed on purpose. The docs site is a static build with no server to ask, and an
artifact regenerated only at deploy time is an artifact nobody reviews in a diff.
`tests/openapi-document.test.ts` fails when either is stale, so "forgot to re-run it"
is a red test rather than a silent one.

`GET /api/v1/openapi.json` serves the same document from the running server, built per
request and unauthenticated — it describes shapes, never rows, and a generator that
needs a credential before it can see the route list is a generator nobody runs.

## Money, and why some routes refuse

`canViewOthersMoney` has no enforcement in `trpc/routers/reports.ts` today. This layer
does not fix that and must not extend it:

- `GET /entries*` runs every row through `projectEntryForVisibility` — a colleague's
  rate becomes `null`.
- `GET /projects*` nulls `progress`, which spans every member's entries.
- `GET /reports/*` **refuses** with `403 money-visibility-required` when the token may
  see colleagues' time but not their money. A report is totals, and there is no honest
  stripped version of a total: zeroing it produces numbers a spreadsheet will sum,
  omitting it produces a report that does not reconcile.

Invoices, CSV and PDF are deliberately absent from v1 for the same reason — money end
to end, with no field left to strip.

Never recompute an amount at read time. `resolveHourlyRate` is write-path only.

## Errors

RFC 9457 `application/problem+json`, built in `api/v1/problem.ts`. Two rules:

- **A 5xx `detail` is the same fixed string in every environment.** The global
  `errorHandler` returns `err.message` verbatim outside production, so a REST handler
  answers its own errors rather than throwing into it — otherwise a driver message
  becomes an API response the moment somebody runs with `NODE_ENV` unset.
- **Cross-workspace and foreign ids answer 404, never 403.** A 403 on a foreign id
  confirms it exists somewhere. `403` is for a scope or money refusal on a resource
  this workspace genuinely owns.

## Rate limits

Fixed 60-second window per token in Redis (`INCR` then a first-write `EXPIRE`), limit
`API_RATE_LIMIT_PER_MINUTE`, default 600. Without Redis it falls back to an in-process
map — per process, which is the documented caveat for a single-container self-host.
A Redis failure falls open on purpose: a blip turning into a 429 storm across every
integration is the larger outage.

## Webhooks

Signing is `HMAC-SHA256(secret, "<timestamp>.<rawBody>")`, hex, sent as `v1=<hex>`.
The failure mode is re-serialization: `rawBody` is computed once, signed, and handed
to `fetch` as `body` — stringify it twice and every receiver doing its job rejects the
delivery as forged.

Deliveries are projected at SEND time against the subscription owner's live
visibility, so a permission change between enqueue and send is honoured; a withheld
delivery is `skipped_visibility`, which is a permission outcome and not a failure.

`assertDeliverableUrl` runs at subscribe time **and again before every attempt** —
DNS rebinding makes a create-time-only check decorative. `redirect: "manual"`; a 3xx
is a failure, because a `Location` header is validated by nothing.
`WEBHOOK_ALLOW_PRIVATE_TARGETS=true` lifts the https and private-address rules and is
for pointing a local listener at a dev server, nowhere else.

## Tests

| File | Pins |
| --- | --- |
| `tests/rest-openapi.test.ts` | The table: mounting, per-route scopes, `/entries/current` before `/entries/:id`, list envelopes. |
| `tests/openapi-document.test.ts` | The document's shape, and that the committed artifacts are not stale. |
| `tests/rest-problem.test.ts` | Problem bodies and status mapping. |
| `tests/rest-rate-limit.test.ts` | The window, headers and 429. |
| `tests/api-token*.test.ts` | Minting, hashing, scope denial, the visibility ceiling. |
| `tests/webhook-*.test.ts` | Signature, SSRF table, projection, backoff, delivery. |
