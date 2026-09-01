import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fromHere = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The popup HTML is emitted at dist/src/popup/index.html but its JS and CSS
  // land at the dist root. Vite's default base ("/") would point them at
  // chrome-extension://<id>/popup.js, which only resolves because the
  // extension root happens to be the URL root — a relative base emits
  // ../../popup.js instead, so the bundle is self-contained no matter where
  // the page is loaded from.
  base: "./",
  // manifest.json and icons/ are copied verbatim into dist/, so the manifest
  // that ships is the one in the repo — no generation step to drift.
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // An MV3 service worker is loaded as a real ES module; no legacy target.
    target: "esnext",
    rollupOptions: {
      input: {
        popup: fromHere("src/popup/index.html"),
        background: fromHere("src/background/index.ts"),
      },
      output: {
        // Every filename here is referenced by a literal string in
        // manifest.json, which has no way to read a build manifest. Hashes
        // would break the service worker registration on every rebuild, so
        // names stay stable and cache-busting is left to Chrome's own
        // extension reload.
        entryFileNames: "[name].js",
        // Only ENTRY names are pinned by the manifest. Shared chunks are named
        // by rollup from whatever module happened to land in them first, which
        // produced a root-level `config.js` that reads like an entry point and
        // would collide outright with a future entry of that name. Hashing them
        // under chunks/ keeps the pinned names to exactly the ones that matter.
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
