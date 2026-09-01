import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import type { NextConfig } from "next";

// Relative asset paths are required by the desktop/mobile shells, which load
// the exported client from file:// (Electron) or the Capacitor bundle.
//
// They are WRONG everywhere else. With `trailingSlash: true` every route is a
// directory, so a page served at /track/ resolves "./_next/..." to
// "/track/_next/..." and every asset 404s — the whole web build renders blank
// on any route but "/". So the prefix is opt-in, set by the native build
// scripts, and never applied to `next dev` or a web production build.
const isDev = process.env.NODE_ENV === "development";
const isNativeBuild = process.env.NATIVE_BUILD === "1";

// Next 16 blocks cross-origin requests to /_next dev resources by default.
// scripts/dev.mjs prints 127.0.0.1 URLs while Next treats localhost as its own
// origin, so without this the dev chunks are blocked, React never hydrates, and
// every form silently falls back to a native submit.
const devOrigins = ["127.0.0.1", "localhost", ...(process.env.NEXT_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])];

const baseConfig: NextConfig = {
  output: "export",
  ...(isDev ? { allowedDevOrigins: devOrigins } : {}),
  ...(isNativeBuild && !isDev ? { assetPrefix: "./" } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@starter/server", "@starter/shared", "@starter/core"],
  // scripts/dev.mjs gives each checkout its own build directory so that two
  // instances (a worktree and the main checkout, say) never share the .next
  // cache or the Next 16 dev-server lock.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

/**
 * Import a module without letting Next's config bundler rewrite the call.
 *
 * Next compiles next.config.ts to CommonJS, which turns a literal `import()`
 * into `require()` — and `require()` of an ESM-only package throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Building the function from a string keeps the
 * import opaque to the bundler, so it survives as a real dynamic import.
 */
const esmImport = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

type LocalDevPlugin = {
  withLocalDev: (config: NextConfig, options: { slug: string }) => NextConfig;
};

/**
 * `@hatchkit/dev-plugin-next` is ESM-only and only does work during
 * `next dev` (it writes the project's Caddy fragment and prints the
 * Tailscale-URL banner), so it is loaded lazily in that phase alone. A
 * failure to load degrades to the plain config rather than breaking the
 * dev server or the build.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return baseConfig;

  try {
    const plugin = (await esmImport(
      "@hatchkit/dev-plugin-next",
    )) as LocalDevPlugin;
    return plugin.withLocalDev(baseConfig, { slug: "tracktime" });
  } catch (err) {
    console.warn(
      "[next.config] @hatchkit/dev-plugin-next could not be loaded — " +
        "continuing without the local-dev integration.",
      err instanceof Error ? err.message : err,
    );
    return baseConfig;
  }
}
