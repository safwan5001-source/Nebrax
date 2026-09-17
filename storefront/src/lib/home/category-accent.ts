/**
 * The merchant's own category colour, prepared for presentation.
 *
 * `store/v1/categories` exposes no image, so colour is the only visual
 * identity a category actually has. It is used as an accent on an otherwise
 * neutral tile rather than as the tile's surface: a grid of saturated or
 * pastel blocks reads as decoration and makes every category shout at the same
 * volume, where a calm grid with a coloured edge keeps the category names the
 * thing being read.
 *
 * The colour reaches us as a free-text column and ends up in a `style`
 * attribute, so it is validated rather than trusted: only a plain hex literal
 * is accepted. Anything else falls back to the neutral treatment, which is a
 * deliberate presentation in its own right, not a broken one.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export interface CategoryAccent {
  /** The tile's accent edge. */
  rule: string;
  /** Whether the value came from the merchant rather than the fallback. */
  isMerchantColor: boolean;
}

const NEUTRAL_ACCENT: CategoryAccent = {
  rule: "var(--store-border-strong)",
  isMerchantColor: false,
};

function expandShorthand(hex: string) {
  if (hex.length !== 4) return hex;
  const [, r, g, b] = hex;
  return `#${r}${r}${g}${g}${b}${b}`;
}

/** Relative luminance, used only to keep a pale accent visible on the tile. */
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

export function categoryAccent(
  color: string | null | undefined,
): CategoryAccent {
  if (!isValidCategoryColor(color)) return NEUTRAL_ACCENT;

  const hex = expandShorthand((color as string).trim().toLowerCase());

  // A near-white category colour would be an invisible edge on a white tile,
  // so it is deepened toward the text colour. The merchant's hue survives;
  // only its lightness is corrected.
  const rule =
    luminance(hex) > 0.75
      ? `color-mix(in srgb, ${hex} 65%, var(--store-foreground))`
      : hex;

  return { rule, isMerchantColor: true };
}
