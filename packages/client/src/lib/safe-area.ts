/**
 * The safe-area insets, as numbers, for the one job CSS cannot do.
 *
 * Everything else about the notch is handled in `styles/native.css` with
 * `env(safe-area-inset-*)`. A Radix popover is the exception: it is placed by
 * Floating UI, which measures collisions against the layout viewport — and
 * under `viewport-fit=cover` the layout viewport starts at the physical top of
 * the screen, under the Dynamic Island. There is no CSS override for that. The
 * popper wrapper carries an inline `transform` computed from those
 * measurements, so a stylesheet can neither move the panel back nor clamp
 * where it is allowed to land; the only lever is Radix's `collisionPadding`,
 * which is a prop, in JavaScript.
 *
 * (Radix's other lever, `collisionBoundary`, is not a substitute. Passing one
 * sets `altBoundary: hasExplicitBoundaries` in @radix-ui/react-popper, which
 * flips detectOverflow to measure the *reference* element instead of the
 * floating one — so an inset boundary element would change which overflow is
 * being avoided, not where the panel may sit.)
 */

/**
 * The four custom properties `styles/native.css` publishes under `html.cap`.
 * Nothing defines them on web, which is what makes the reader below return
 * zeroes there.
 */
const INSET_VARS = {
  top: "--app-safe-area-top",
  right: "--app-safe-area-right",
  bottom: "--app-safe-area-bottom",
  left: "--app-safe-area-left",
} as const;

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Reads a CSS length that may be absent, malformed, or an unsubstituted
 * `env()` token, and answers 0 for all three.
 *
 * The last case is the one worth naming: `env()` inside a custom property is
 * substituted at computed-value time exactly like `var()`, so a browser hands
 * back `59px`. If some engine ever handed back the literal `env(…)` instead,
 * `parseFloat` gives `NaN` and this returns 0 — which is today's behaviour,
 * not a new one. A failure here degrades to the unfixed popover, never to a
 * popover positioned by a nonsense number.
 */
function toPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** The property reader `readSafeAreaInsets` uses. Injected only by its test. */
export type PropertyReader = (name: string) => string;

function documentReader(): PropertyReader {
  if (typeof document === "undefined") return () => "";
  const style = getComputedStyle(document.documentElement);
  return (name) => style.getPropertyValue(name);
}

export function readSafeAreaInsets(
  read: PropertyReader = documentReader(),
): SafeAreaInsets {
  return {
    top: toPixels(read(INSET_VARS.top)),
    right: toPixels(read(INSET_VARS.right)),
    bottom: toPixels(read(INSET_VARS.bottom)),
    left: toPixels(read(INSET_VARS.left)),
  };
}

/** Radix's own shape for `collisionPadding`. */
export type CollisionPadding =
  | number
  | Partial<Record<"top" | "right" | "bottom" | "left", number>>;

/**
 * `base` widened by whatever the notch and the home indicator take.
 *
 * Returns `base` ITSELF — same value, same identity — when there are no
 * insets, which is every browser, every desktop shell and every test that has
 * not gone out of its way to publish the variables. So on web this function is
 * provably a no-op rather than a "0 + 0 happens to be 0" no-op: `undefined`
 * stays `undefined` and Radix keeps its own default, and a caller's `8` stays
 * the number `8` rather than becoming an object.
 */
export function withSafeArea<T extends CollisionPadding | undefined>(
  base: T,
  insets: SafeAreaInsets = readSafeAreaInsets(),
): T | Record<"top" | "right" | "bottom" | "left", number> {
  if (
    insets.top === 0 &&
    insets.right === 0 &&
    insets.bottom === 0 &&
    insets.left === 0
  ) {
    return base;
  }

  // Widened out of the generic before the narrowing: TypeScript will not
  // spread a `T`, only the union it is constrained to.
  const value: CollisionPadding | undefined = base;
  const sides =
    typeof value === "number"
      ? { top: value, right: value, bottom: value, left: value }
      : { top: 0, right: 0, bottom: 0, left: 0, ...(value ?? {}) };

  return {
    top: sides.top + insets.top,
    right: sides.right + insets.right,
    bottom: sides.bottom + insets.bottom,
    left: sides.left + insets.left,
  };
}
