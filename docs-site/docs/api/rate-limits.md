---
sidebar_position: 4
description: The per-token and per-workspace request budgets, the RateLimit headers on every response, and how the limit behaves without Redis.
---

# Rate limits

Each API token gets a fixed budget per 60-second window — **600 requests per minute**
by default, configurable per deployment with `API_RATE_LIMIT_PER_MINUTE`.

The counter is keyed on the **token**, not on the user or the IP. A token is the unit
you can revoke and re-mint, so it is the unit whose misbehaviour can be isolated: one
broken script cannot starve your other integrations, and an office behind one address
is not one shared budget.

## The workspace ceiling

Every request is charged to a second counter as well: the **workspace**, at **4x the
per-token limit** (2,400 requests per minute by default).

It exists because nothing stops you minting more tokens. A limit keyed only on the
token is a limit you defeat by round-robining a hundred of them for a hundred times
the budget, so the token counter alone would be an accounting convenience rather than
a cap. Four times, and not one times, because a workspace legitimately runs several
integrations at once — a shared budget equal to a single token's would make your
second integration a cause of 429s for your first, which is the starvation that
keying on the token was meant to prevent.

In practice a single runaway token hits its own ceiling first and leaves its siblings
working. You only meet the workspace ceiling by running several integrations hot at
the same time; the fix then is fewer concurrent requests, not more tokens.

## Failed authentication

Requests that never authenticate are counted separately at **30 per minute** — that
budget is not configurable. A 401 happens before any token is known to exist, so it
cannot be keyed on a token id.

It is keyed on your **source address together with the token prefix you presented**,
not on the address alone. That matters if you share an egress address with anybody —
an office NAT, a shared CI runner, a PaaS egress pool. One revoked token still being
retried by its cron burns only *its own* budget: every other integration coming from
the same address, and every valid credential, is unaffected. Requests carrying no
token, or one that is not even shaped like a token, are counted against the bare
address; they cost no lookup and never share a budget with a real credential.

Only the 401 branch is charged. Authenticating successfully costs you nothing, so the
only way to reach this limit is to keep presenting a credential that does not work —
usually a token that has been revoked, or one mistyped in a script. Fix the token
rather than retrying it.

This is a meter for a credential that keeps failing, not general flood control. A
caller who varies the prefix on every request is not gated by it at all; that job
belongs to whatever sits in front of the process.

## Headers

Every authenticated response — the successes too, not only the refusals — carries:

| Header | Meaning |
| --- | --- |
| `RateLimit-Limit` | Requests allowed per window, under the binding budget. |
| `RateLimit-Remaining` | Requests left in the current window, under the same budget. |
| `RateLimit-Reset` | Seconds until the window rolls over. |

Since there are two budgets, the headers report whichever is closer to refusing — the
constraint that will actually turn down your next request. Sizing a backoff against
the other one would have you slow down for a wall you are not about to hit, or not
slow down for the one you are.

On a 429, `Retry-After` is sent as well, in seconds.

They are on the 200 deliberately: a client that can only learn its budget by being
refused has to hit the wall to find out where it is. Watch `RateLimit-Remaining` and
slow down before it reaches zero.

## Being refused

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
RateLimit-Limit: 600
RateLimit-Remaining: 0
RateLimit-Reset: 17
Retry-After: 17
```

```json
{
  "type": "https://tracktime.trebeljahr.com/problems/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit of 600 requests per minute exceeded. Retry in 17s.",
  "instance": "/api/v1/entries"
}
```

Sleep for `Retry-After` and continue. Do not retry immediately in a loop — the window
is fixed, so an immediate retry is simply refused again and burns nothing but your own
throughput.

## Fixed window, and what that costs

The window is fixed, not sliding: the counter resets on the minute boundary rather
than aging out request by request. That means up to twice the limit can land across
two adjacent windows, which for an integration API is the right trade — the limit
exists to stop a runaway loop, not to shape traffic to the millisecond.

## Self-hosting

The counter lives in Redis. With `REDIS_URL` unset, it falls back to an in-process
counter: the limit still works, but it applies **per process**, so a two-replica
deployment without Redis effectively doubles it. That is fine for a single container
and wrong for a scaled one — set `REDIS_URL` if you run more than one.

The in-process map is bounded on purpose. Keys are dropped when the window rolls
over, and the authenticated and failed-authentication counters live in separate maps
with separate entry ceilings — so unauthenticated traffic, which costs nothing but a
socket to send, can neither grow the process without bound nor crowd out the counter
that limits authenticated callers. At a ceiling the limiter **falls open** for keys it
has no room for, for the same reason it falls open when Redis is down.

The failed-authentication meter is only sound if `TRUST_PROXY_HOPS` matches your
deployment — see `docs/deploy.md`. It is keyed on the client address Express resolves,
and Express can only resolve that correctly when it knows how many proxies are in
front of it.

If Redis is configured and then fails, the limiter **falls open**: requests are allowed
and report a full budget. Turning a Redis blip into a 429 storm across every
integration would be a much larger outage than the one being guarded against.
