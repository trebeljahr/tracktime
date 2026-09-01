#!/usr/bin/env node
/**
 * Print the Chrome extension id, and the origin the server has to trust.
 *
 * The origin matters because better-auth force-validates it on sign-in. A real
 * browser sends `Sec-Fetch-Site`/`Sec-Fetch-Mode`, which makes better-auth
 * check the `Origin` header against `trustedOrigins` even with no cookie on
 * the request; an untrusted extension origin gets a flat
 * `403 {"code":"INVALID_ORIGIN"}` before the password is ever looked at.
 *
 * Two ways an id comes about, and this reports whichever applies:
 *
 *  - A `key` pinned in the manifest fixes the id wherever it is loaded from.
 *    That is the only way to know a production id before uploading anything.
 *  - Otherwise an unpacked extension's id is derived from the absolute path it
 *    was loaded from — stable for a directory, different for every checkout.
 *
 *   node scripts/extension-id.mjs [dev|prod|<path-to-unpacked-dir>]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXTENSION = new URL("../packages/extension/", import.meta.url).pathname;

const TARGETS = {
  dev: join(EXTENSION, "dist"),
  development: join(EXTENSION, "dist"),
  prod: join(EXTENSION, "dist-prod"),
  production: join(EXTENSION, "dist-prod"),
};

const argument = process.argv[2] ?? "dev";
const target = resolve(TARGETS[argument] ?? argument);

if (!existsSync(target)) {
  console.error(`No such directory: ${target}`);
  console.error(
    argument === "prod" || argument === "production"
      ? "Build it first with:  pnpm run build:extension:prod"
      : "Build it first with:  pnpm run build:extension",
  );
  process.exit(1);
}

const idFromBytes = (bytes) =>
  [...createHash("sha256").update(bytes).digest("hex").slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join("");

/**
 * A pinned key wins: Chrome derives the id from the public key's DER bytes,
 * and ignores the path entirely.
 */
const pinnedKey = () => {
  const manifestPath = join(target, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof manifest.key === "string" && manifest.key !== ""
      ? manifest.key
      : null;
  } catch {
    return null;
  }
};

const key = pinnedKey();
// Chrome hashes the path bytes as-is on POSIX (UTF-16LE on Windows, which this
// deliberately does not try to emulate — it would be wrong on the host it ran on).
const id = key ? idFromBytes(Buffer.from(key, "base64")) : idFromBytes(target);

console.log(`path:   ${target}`);
console.log(`source: ${key ? "pinned manifest key" : "unpacked load path"}`);
console.log(`id:     ${id}`);
console.log(`origin: chrome-extension://${id}`);
console.log();
if (key) {
  console.log("Pinned by a manifest key, so this id holds wherever it loads from.");
} else {
  console.log("Derived from the path — loading the same build from elsewhere");
  console.log("changes the id. Pin EXTENSION_KEY to fix it (see manifest.config.ts).");
}
console.log();
console.log("Add that origin to TRUSTED_ORIGINS in packages/server/.env.<env>,");
console.log("then restart the server — the env file is read at boot, not watched.");
