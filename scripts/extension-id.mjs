#!/usr/bin/env node
/**
 * Print the Chrome extension id, and the origin the server has to trust.
 *
 * An unpacked extension has no signing key, so Chrome derives its id from the
 * absolute path it was loaded from: sha256 of that path, first 16 bytes, each
 * hex digit mapped onto a–p. The id is therefore stable for a given directory
 * and different for every checkout — which is why this is computed rather than
 * hardcoded.
 *
 * The origin matters because better-auth force-validates it on sign-in. A real
 * browser sends `Sec-Fetch-Site`/`Sec-Fetch-Mode`, which makes better-auth
 * check the `Origin` header against `trustedOrigins` even with no cookie on
 * the request; an untrusted extension origin gets a flat
 * `403 {"code":"INVALID_ORIGIN"}` before the password is ever looked at.
 *
 *   node scripts/extension-id.mjs [path-to-unpacked-dir]
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(
  process.argv[2] ?? new URL("../packages/extension/dist", import.meta.url).pathname,
);

if (!existsSync(target)) {
  console.error(`No such directory: ${target}`);
  console.error("Build it first with:  pnpm run build:extension");
  process.exit(1);
}

// Chrome hashes the path bytes as-is on POSIX (UTF-16LE on Windows, which this
// deliberately does not try to emulate — it would be wrong on the host it ran on).
const digest = createHash("sha256").update(target).digest("hex").slice(0, 32);
const id = [...digest].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

console.log(`path:   ${target}`);
console.log(`id:     ${id}`);
console.log(`origin: chrome-extension://${id}`);
console.log();
console.log("Add that origin to TRUSTED_ORIGINS in packages/server/.env.<env>,");
console.log("then restart the server — the env file is read at boot, not watched.");
