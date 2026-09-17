/**
 * Category tiles get their visual identity from the merchant's own category
 * colour. `store/v1/categories` exposes no image, so the alternative would be
 * inventing category photography — which would make the storefront assert
 * something AWJ never said.
 *
 * The colour reaches us as a free-text column, and it ends up in a `style`
 * attribute, so it is validated rather than trusted: only a plain hex literal
 * is accepted. Anything else falls back to the neutral treatment, which is a
 * deliberate presentation in its own right, not a broken one.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface CategoryAccent {
  /** Tile surface. */
  background: string;
  /** Mark and label colour on that surface. */
  foreground: string;
}

const NEUTRAL_ACCENT: CategoryAccent = {
  background: "var(--store-surface-muted)",
  foreground: "var(--store-muted-foreground)",
};

function expandShorthand(hex: string) {
  if (hex.length !== 4) return hex;
  const [, r, g, b] = hex;
  return `#${r}${r}${g}${g}${b}${b}`;
}

/** Relative luminance, used only to keep the label legible on the tile. */
function luminance(hex: string) {
  const full = expandShorthand(hex).slice(1);
  const channels = [0, 2, 4].map((i) => {
    const value = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function isValidCategoryColor(color: string | null | undefined) {
  return typeof color === "string" && HEX_COLOR.test(color.trim());
}

/**
 * A soft wash of the category's colour rather than the colour at full
 * strength: a grid of saturated blocks reads as decoration, while a tinted
 * surface reads as a category system.
 */
export function categoryAccent(
  color: string | null | undefined,
): CategoryAccent {
  if (!isValidCategoryColor(color)) return NEUTRAL_ACCENT;

  const hex = expandShorthand((color as string).trim().toLowerCase());
  // A light colour would wash out against the page, so the tint strength and
  // the label colour both follow the colour's own lightness.
  const isLight = luminance(hex) > 0.6;

  return {
    background: `color-mix(in srgb, ${hex} ${isLight ? "22%" : "12%"}, var(--store-surface))`,
    foreground: isLight
      ? "var(--store-foreground)"
      : `color-mix(in srgb, ${hex} 78%, var(--store-foreground))`,
  };
}
