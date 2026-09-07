#!/usr/bin/env node
/*
 * Rasterize every bitmap the app ships from the one brand mark.
 *
 * `mark-tile.svg` is the canonical mark. The bare timer arc draws a neutral
 * track ring meant for a page background, which disappears against browser
 * chrome, a macOS dock or a menu bar; the tile carries its own indigo ground
 * and reads the same everywhere. So every raster surface derives from the
 * tile, and this script is what keeps them derived instead of drifting into
 * hand-edited binaries nobody can regenerate. (They had: before this script
 * existed, every PNG below except the extension's was a flat #6366F1 square
 * with no mark in it at all — the starter placeholder, inherited by the
 * Electron, Tauri, Raycast and Capacitor builds in turn.)
 *
 * The generated files are committed, because the toolchains that consume them
 * cannot rasterize an SVG themselves: Chrome's `icons` manifest key takes PNG
 * only, `tauri icon` and `capacitor-assets` take a PNG source, and Raycast
 * reads PNG from `assets/`.
 *
 * Run after any change to the mark:  pnpm run icons:brand
 * Then re-run the downstream generators that fan these out further:
 *   pnpm run icons:desktop   build/icon.png  -> icns + ico
 *   pnpm run icons:tauri     build/icon.png  -> src-tauri/icons/*
 *   pnpm run mobile:assets   resources/*.png -> ios/ + android/
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const brand = path.join(root, "packages/client/public/brand");

/** The mark's own viewBox, needed to turn a target pixel size into a DPI. */
const SVG_VIEWBOX_PX = 64;
/** librsvg's baseline DPI — density scales the render relative to this. */
const BASE_DPI = 72;
/** Render at 4x and downsample, so curved edges land on antialiased pixels. */
const SUPERSAMPLE = 4;

/** The splash's ground. Matches `mobile:assets --iconBackgroundColor`. */
const SPLASH_BG = "#FFFFFF";
/** How much of the splash square the mark occupies. */
const SPLASH_MARK_FRACTION = 0.25;

const tile = await readFile(path.join(brand, "mark-tile.svg"));

/** Rasterize an SVG buffer to an exact square, transparent behind it. */
async function render(svg, size) {
  const density = Math.round((BASE_DPI * size * SUPERSAMPLE) / SVG_VIEWBOX_PX);
  return sharp(svg, { density })
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function emit(relPath, buffer) {
  const out = path.join(root, relPath);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, buffer);
  console.log(`${relPath}  ${buffer.length} bytes`);
}

/**
 * Every square PNG target, and why it exists.
 *
 * Sizes are what each consumer asks for at its largest: the downstream
 * generators (icon-gen, `tauri icon`, capacitor-assets) produce the smaller
 * variants from these, so there is no point committing those by hand.
 */
const TARGETS = [
  // Chrome: toolbar (16/32), management page (48), Web Store (128).
  ["packages/extension/public/icons/16.png", 16],
  ["packages/extension/public/icons/32.png", 32],
  ["packages/extension/public/icons/48.png", 48],
  ["packages/extension/public/icons/128.png", 128],
  // electron-builder reads this directly for Linux, and `icons:desktop`
  // derives icon.icns / icon.ico from it. `icons:tauri` reads it too.
  ["build/icon.png", 512],
  // Raycast's store listing and every command's icon.
  ["packages/raycast/assets/icon.png", 512],
  // Raycast's menu bar item. Rendered around 16pt, so 64px covers 2x displays
  // with room to spare; Raycast downscales.
  ["packages/raycast/assets/menu-bar.png", 64],
  // capacitor-assets' source for the iOS and Android launcher icons.
  ["resources/icon.png", 1024],
];

for (const [relPath, size] of TARGETS) {
  await emit(relPath, await render(tile, size));
}

/*
 * The splash is the one composite: capacitor-assets wants a large square whose
 * middle is safe area on every device aspect ratio, so the mark sits small and
 * centered on a flat ground rather than filling the frame.
 */
const SPLASH_PX = 2732;
const markPx = Math.round(SPLASH_PX * SPLASH_MARK_FRACTION);
const splash = await sharp({
  create: {
    width: SPLASH_PX,
    height: SPLASH_PX,
    channels: 4,
    background: SPLASH_BG,
  },
})
  .composite([{ input: await render(tile, markPx), gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await emit("resources/splash.png", splash);

/*
 * The docs site's Open Graph card. Docusaurus links the PNG (crawlers do not
 * render SVG), but the SVG next to it is the editable source, so the card is
 * rasterized here rather than exported by hand.
 */
const socialSvg = await readFile(
  path.join(root, "docs-site/static/img/social-card.svg"),
);
const socialPng = await sharp(socialSvg, { density: BASE_DPI * 2 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toBuffer();
await emit("docs-site/static/img/social-card.png", socialPng);
