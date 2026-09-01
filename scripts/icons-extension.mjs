#!/usr/bin/env node
/*
 * Rasterize the extension's toolbar and Web Store icons from the brand mark.
 *
 * Chrome's `icons` key takes PNG only — an SVG cannot be referenced there, and
 * a service worker cannot rasterize one either (`createImageBitmap` rejects
 * SVG off the main thread). So the mark has to be committed as bitmaps, and
 * this script exists so those bitmaps stay derived from the SVG instead of
 * drifting into hand-edited binaries nobody can regenerate.
 *
 * The tile variant is used rather than the bare timer arc: the arc's neutral
 * track ring is drawn for a page background and disappears against the
 * browser's own chrome, whereas the tile carries its own indigo ground and
 * reads the same on a light or dark toolbar. It is also the shape the Raycast
 * and desktop builds already ship, so all three surfaces match.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(
  root,
  "packages/client/public/brand/mark-tile.svg",
);
const outDir = path.join(root, "packages/extension/public/icons");

/** The sizes Chrome asks for: toolbar (16/32), management page (48), store (128). */
const SIZES = [16, 32, 48, 128];

/** The mark's own viewBox, needed to turn a target pixel size into a DPI. */
const SVG_VIEWBOX_PX = 64;
/** librsvg's baseline DPI — density scales the render relative to this. */
const BASE_DPI = 72;
/** Render at 4x and downsample, so curved edges land on antialiased pixels. */
const SUPERSAMPLE = 4;

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });

for (const size of SIZES) {
  const density = Math.round(
    (BASE_DPI * size * SUPERSAMPLE) / SVG_VIEWBOX_PX,
  );
  const png = await sharp(svg, { density })
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(outDir, `${size}.png`), png);
  console.log(`icons/${size}.png  ${png.length} bytes`);
}
