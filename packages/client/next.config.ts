import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import type { NextConfig } from "next";

const baseConfig: NextConfig = {
  output: "export",
  assetPrefix: "./",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@starter/server", "@starter/shared", "@starter/core"],
};

/**
 * `@hatchkit/dev-plugin-next` is ESM-only — its package exports map declares
 * an "import" condition but no "require" one — while Next 16 loads
 * next.config.ts through CJS. Importing it at the top level therefore fails
 * `next build` with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * The plugin only does anything during `next dev` (it writes the project's
 * Caddy fragment and prints the Tailscale-URL banner), so it is loaded
 * lazily in that phase only, and a failure to load degrades to the plain
 * config instead of breaking the dev server.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return baseConfig;

  try {
    const { withLocalDev } = await import("@hatchkit/dev-plugin-next");
    return withLocalDev(baseConfig, { slug: "tracktime" });
  } catch (err) {
    console.warn(
      "[next.config] @hatchkit/dev-plugin-next could not be loaded — " +
        "continuing without the local-dev integration.",
      err,
    );
    return baseConfig;
  }
}
