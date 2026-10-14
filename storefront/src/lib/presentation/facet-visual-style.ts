/**
 * AWJ-VD-H1 / VD-2 — the shape engine for facet visuals: geometry, sizes and the icon-colour contrast guard.
 *
 * Data only (no React). Twin of `web/.../presentation/facet-visual-style.ts` (byte-identical, test-enforced).
 *
 * Every shape is a **render-time mask over the same original image** (D-09): geometry lives here as code constants and
 * documents carry only the shape key, so no merchant input can ever reach CSS or SVG.
 *
 * - Simple shapes use `border-radius` + `aspect-ratio`.
 * - Polygons use `clip-path: polygon(%)` (responsive; Baseline since 2020).
 * - Curved shapes (heart, vase, arch) use an SVG `mask-image` data URI stretched with `mask-size: 100% 100%`. It is
 *   responsive, needs no DOM ids (SSR-safe, any number of tiles per page) and is Baseline widely available.
 *   `path()` is not used (fixed coordinates do not scale) and neither is `shape()` (Baseline low).
 * - All shapes are horizontally symmetric, so RTL needs no mirroring.
 */

import type { FacetVisualShape, FacetVisualSize } from "./facet-visual";

export type FacetShapeAspect = "1 / 1" | "4 / 3" | "3 / 4";

export interface FacetShapeGeometry {
  aspect: FacetShapeAspect;
  /** `border-radius` for rounded shapes. */
  radius?: string;
  /** `clip-path: polygon(...)` points, in percentages. */
  polygon?: string;
  /** SVG path in a 0..100 × 0..100 viewBox, used as an alpha mask (stretched to the frame). */
  maskPath?: string;
  /** Icon box (percent of the frame) when the shape's open interior is narrower than the default 46%. */
  iconBox?: string;
}

export const FACET_SHAPE_GEOMETRY: Readonly<
  Record<FacetVisualShape, FacetShapeGeometry>
> = {
  circle: { aspect: "1 / 1", radius: "50%" },
  square: { aspect: "1 / 1", radius: "0" },
  rounded: { aspect: "1 / 1", radius: "18%" },
  landscape: { aspect: "4 / 3", radius: "8%" },
  portrait: { aspect: "3 / 4", radius: "8%" },
  oval: { aspect: "4 / 3", radius: "50%" },
  star: {
    aspect: "1 / 1",
    polygon:
      "50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 95%, 50% 73%, 21% 95%, 32% 57%, 2% 35%, 39% 35%",
    iconBox: "34%",
  },
  heart: {
    aspect: "1 / 1",
    maskPath:
      "M50 92 C20 72 2 54 2 32 C2 15 15 4 29 4 C39 4 46 10 50 18 C54 10 61 4 71 4 C85 4 98 15 98 32 C98 54 80 72 50 92 Z",
  },
  diamond: { aspect: "1 / 1", polygon: "50% 0%, 100% 50%, 50% 100%, 0% 50%" },
  hexagon: {
    aspect: "1 / 1",
    polygon: "25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%",
  },
  vase: {
    aspect: "3 / 4",
    maskPath:
      "M30 0 H70 V8 C70 14 62 16 62 24 C62 32 92 40 92 64 C92 86 76 100 50 100 C24 100 8 86 8 64 C8 40 38 32 38 24 C38 16 30 14 30 8 Z",
  },
  // A pointed (Islamic) arch: straight jambs and two curves meeting at a point.
  arch: {
    aspect: "3 / 4",
    maskPath: "M0 100 V42 C0 22 22 8 50 0 C78 8 100 22 100 42 V100 Z",
  },
};

/** The icon box inside a shape's frame, sized so the glyph stays inside the shape. */
export function facetIconBox(shape: FacetVisualShape): string {
  return (
    (FACET_SHAPE_GEOMETRY[shape] ?? FACET_SHAPE_GEOMETRY.circle).iconBox ??
    "46%"
  );
}

/** Frame width in CSS pixels per size; layouts may shrink a tile but never grow it past this. */
export const FACET_VISUAL_SIZE_PX: Readonly<Record<FacetVisualSize, number>> = {
  sm: 56,
  md: 80,
  lg: 112,
};

function maskUrl(path: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${path}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Inline style for the media frame of a shape (React `style` keys). The frame clips its content; the content itself
 * is laid out by the tile.
 */
export function facetShapeFrameStyle(
  shape: FacetVisualShape,
): Record<string, string> {
  const geometry = FACET_SHAPE_GEOMETRY[shape] ?? FACET_SHAPE_GEOMETRY.circle;
  const style: Record<string, string> = {
    aspectRatio: geometry.aspect,
    overflow: "hidden",
  };
  if (geometry.radius !== undefined) style.borderRadius = geometry.radius;
  if (geometry.polygon !== undefined)
    style.clipPath = `polygon(${geometry.polygon})`;
  if (geometry.maskPath !== undefined) {
    const url = maskUrl(geometry.maskPath);
    style.maskImage = url;
    style.WebkitMaskImage = url;
    style.maskSize = "100% 100%";
    style.WebkitMaskSize = "100% 100%";
    style.maskRepeat = "no-repeat";
    style.WebkitMaskRepeat = "no-repeat";
  }
  return style;
}

/** Inline style for an image inside a frame: fit, focal point and zoom (all CSS, nothing baked — D-09). */
export function facetImageStyle(image: {
  fit: "cover" | "contain";
  focal?: { x: number; y: number };
  zoom?: number;
}): Record<string, string> {
  const x = image.focal?.x ?? 50;
  const y = image.focal?.y ?? 50;
  const style: Record<string, string> = {
    width: "100%",
    height: "100%",
    objectFit: image.fit,
    objectPosition: `${x}% ${y}%`,
  };
  if (image.zoom !== undefined && image.zoom > 1) {
    style.transform = `scale(${image.zoom})`;
    style.transformOrigin = `${x}% ${y}%`;
  }
  return style;
}

// ───────────────────────────── contrast (WCAG 2.2, SC 1.4.11) ─────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Non-text contrast minimum for an icon that identifies the tile. */
export const FACET_ICON_MIN_CONTRAST = 3;

/** Dark and light icon colours used when the merchant's colour cannot be read on the merchant's background. */
export const FACET_ICON_DARK = "#111827";
export const FACET_ICON_LIGHT = "#ffffff";

/** A `#rrggbb` colour: the only colour form a visual document may carry, re-checked at the render boundary. */
export function isFacetHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/**
 * The icon colour to render, or `undefined` for the theme colour.
 *
 * - With an explicit merchant background (known hex), the result is **always readable** (≥ 3:1): the merchant's colour
 *   when it passes, otherwise the better of dark/light. The theme primary is never trusted there, because its value is
 *   unknown here and could match the background.
 * - Without one, the merchant's colour is kept and the theme colour applies otherwise; the theme pairs its own surface
 *   and primary.
 */
export function readableIconColor(
  iconColor: string | undefined,
  background: string | undefined,
): string | undefined {
  const merchant = isFacetHexColor(iconColor) ? iconColor : undefined;
  if (!isFacetHexColor(background)) return merchant;
  if (
    merchant &&
    contrastRatio(merchant, background) >= FACET_ICON_MIN_CONTRAST
  )
    return merchant;
  return contrastRatio(FACET_ICON_DARK, background) >=
    contrastRatio(FACET_ICON_LIGHT, background)
    ? FACET_ICON_DARK
    : FACET_ICON_LIGHT;
}
