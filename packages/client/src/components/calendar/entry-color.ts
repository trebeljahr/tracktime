// Project tints for calendar blocks. `color-mix` keeps the tint translucent,
// so the same value reads correctly on both the light and dark surface.

/** Used for entries with no project. */
export const NO_PROJECT_COLOR = "#64748b";

export type BlockPalette = {
  /** Fill of the block. */
  background: string;
  /** The 3px accent down the leading edge. */
  accent: string;
  /** Border of the block. */
  border: string;
};

/** Palette for a project color (hex) — `null` falls back to a neutral slate. */
export const blockPalette = (
  color: string | null,
  emphasized = false
): BlockPalette => {
  const base = color ?? NO_PROJECT_COLOR;
  return {
    background: `color-mix(in srgb, ${base} ${emphasized ? 34 : 20}%, transparent)`,
    accent: base,
    border: `color-mix(in srgb, ${base} ${emphasized ? 90 : 55}%, transparent)`,
  };
};
