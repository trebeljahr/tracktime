#!/usr/bin/env node
// Serves the client's static export for the E2E suite.
//
// The suite deliberately runs against the exported bundle rather than
// `next dev`: Next 16's dev server detaches itself, which fights Playwright's
// process management and left the client port dead partway through a run. The
// export is also what actually ships, so this exercises the real artifact —
// including the asset paths, which is where a whole class of bugs lives.
//
// The server itself is `packages/client/serve.mjs`, the same one the client
// image runs in production. Keeping a separate copy here meant the suite could
// pass against resolution rules the deployment did not have.

process.env.PORT ??= process.env.E2E_CLIENT_PORT ?? "49762";
// Loopback only: a test run has no business being reachable off the machine.
process.env.HOST ??= "127.0.0.1";

await import("../packages/client/serve.mjs");
