/**
 * AWJ-STORE-CAT-DESIGN-01 — resolves the stored `design.display` of a `categories` section into a render-ready model.
 *
 * The one place that knows the layout defaults, which combinations a layout supports, and how a stored value becomes a CSS
 * custom property. Twin of `web/.../presentation/categories-display.ts` (byte-identical, test-enforced): the published
 * storefront and the builder's Canvas both draw through this model and the same `CategoryDisplayList` view, so the preview is
 * the storefront's own markup rather than a second, divergent mock.
 *
 * Contract rules this file enforces (the stored value is already normalized by `normalizeDisplay`):
 *  - **Absent display ⇒ the classic tile** — the caller never reaches this module (`display === undefined`).
 *  - A layout supports a closed set of name placements and image shapes; anything else is coerced to the layout's own
 *    default (the editor never offers them, but a hand-written document must still draw something coherent).
 *  - An overlaid name always has a contrast-proven backing: `none` is coerced to the scrim, whose token pair is test-proven
 *    >= 4.5:1 over any photo; on the scrim the text colour is the scrim's own foreground.
 *  - A tile can never be empty: hiding both the image and the name keeps the name.
 *  - Nothing here reads, hides or invents catalogue data: it only presents the categories the catalogue returned.
 */

import {
  type CategoryDisplay,
  DISPLAY_DEVICES,
  type DisplayCard,
  type DisplayDevice,
  type DisplayImage,
  type DisplayLayout,
  type DisplayName,
  type PerDevice,
} from "./section-design";

export type Placement = NonNullable<DisplayName["placement"]>;
export type ImageShape = NonNullable<DisplayImage["shape"]>;
export type CardStyle = NonNullable<DisplayCard["style"]>;

/** Which name placements a layout supports; the first is the layout's default. */
export const LAYOUT_PLACEMENTS: Record<DisplayLayout, readonly Placement[]> = {
  grid: ["below", "above", "overlay", "beside"],
  horizontal_scroll: ["below", "above", "overlay"],
  circles: ["below", "above"],
  image_tiles: ["overlay", "below", "above"],
  compact_list: ["beside"],
};

/** Which image shapes a layout supports; the first is the layout's default. */
export const LAYOUT_SHAPES: Record<DisplayLayout, readonly ImageShape[]> = {
  grid: ["rect", "square", "circle"],
  horizontal_scroll: ["rect", "square", "circle"],
  circles: ["circle"],
  image_tiles: ["rect", "square"],
  compact_list: ["square", "circle"],
};

/** Layouts that scroll sideways (a fixed item width, no column count). */
export function isScrollLayout(layout: DisplayLayout): boolean {
  return layout === "horizontal_scroll" || layout === "circles";
}

/** Layouts whose item count per row is a column count. */
export function usesColumns(layout: DisplayLayout): boolean {
  return !isScrollLayout(layout);
}

interface LayoutDefaults {
  columns: Record<DisplayDevice, number>;
  gap: Record<DisplayDevice, number>;
  itemWidth: Record<DisplayDevice, number>;
  cardStyle: CardStyle;
  padding: number;
  aspect: "1:1" | "4:3" | "3:2" | "16:9";
  nameAlign: "start" | "center" | "end";
  nameSize: number;
  nameWeight: 400 | 500 | 600 | 700 | 800;
  /** Compact list thumbnail edge (px), per device. */
  thumb: Record<DisplayDevice, number>;
}

const same = <T>(value: T): Record<DisplayDevice, T> => ({
  mobile: value,
  tablet: value,
  desktop: value,
});

/**
 * Per-layout starting values. They approximate the classic tile's rhythm (12 px gaps, a bordered themed card, bold
 * two-line names) so choosing a layout does not jump to an unrelated look.
 */
export const LAYOUT_DEFAULTS: Record<DisplayLayout, LayoutDefaults> = {
  grid: {
    columns: { mobile: 2, tablet: 3, desktop: 6 },
    gap: same(12),
    itemWidth: same(160),
    cardStyle: "border",
    padding: 12,
    aspect: "4:3",
    nameAlign: "start",
    nameSize: 14,
    nameWeight: 700,
    thumb: same(48),
  },
  horizontal_scroll: {
    columns: { mobile: 2, tablet: 3, desktop: 6 },
    gap: same(12),
    itemWidth: { mobile: 140, tablet: 160, desktop: 180 },
    cardStyle: "border",
    padding: 12,
    aspect: "4:3",
    nameAlign: "start",
    nameSize: 14,
    nameWeight: 700,
    thumb: same(48),
  },
  circles: {
    columns: { mobile: 2, tablet: 3, desktop: 6 },
    gap: { mobile: 16, tablet: 16, desktop: 20 },
    itemWidth: { mobile: 88, tablet: 104, desktop: 120 },
    cardStyle: "none",
    padding: 0,
    aspect: "1:1",
    nameAlign: "center",
    nameSize: 13,
    nameWeight: 600,
    thumb: same(48),
  },
  image_tiles: {
    columns: { mobile: 2, tablet: 3, desktop: 4 },
    gap: same(12),
    itemWidth: same(160),
    cardStyle: "none",
    padding: 0,
    aspect: "4:3",
    nameAlign: "center",
    nameSize: 15,
    nameWeight: 700,
    thumb: same(48),
  },
  compact_list: {
    columns: { mobile: 1, tablet: 2, desktop: 3 },
    gap: same(8),
    itemWidth: same(160),
    cardStyle: "border",
    padding: 8,
    aspect: "1:1",
    nameAlign: "start",
    nameSize: 14,
    nameWeight: 600,
    thumb: same(48),
  },
};

export const COMPACT_THUMB_RANGE = [32, 96] as const;

const RATIO: Record<string, string> = {
  "1:1": "1 / 1",
  "4:3": "4 / 3",
  "3:2": "3 / 2",
  "16:9": "16 / 9",
};

const COLOR_TOKEN: Record<string, string> = {
  foreground: "var(--store-foreground)",
  muted: "var(--store-muted-foreground)",
  primary: "var(--store-primary)",
};
const BORDER_TOKEN: Record<string, string> = {
  border: "var(--store-border)",
  strong: "var(--store-border-strong)",
  primary: "var(--store-primary)",
  accent: "var(--store-accent, var(--store-primary))",
};
const BACKGROUND_TOKEN: Record<string, string> = {
  surface: "var(--store-surface)",
  muted: "var(--store-surface-muted)",
  transparent: "transparent",
};
/** Fixed, soft shadow: the contract offers a style, never a free shadow string. */
const SOFT_SHADOW =
  "0 1px 3px rgb(17 24 39 / 0.1), 0 1px 2px rgb(17 24 39 / 0.06)";

export type Dir = "ltr" | "rtl";

export interface ResolvedCategoryDisplay {
  layout: DisplayLayout;
  /** Sideways-scrolling layout (fixed item width) rather than a column grid. */
  scroll: boolean;
  card: {
    style: CardStyle;
    hover: boolean;
  };
  image: {
    show: boolean;
    shape: ImageShape;
    /** The bounded custom height per device, `null` where the aspect ratio decides. */
    heights: Record<DisplayDevice, number | null>;
  };
  name: {
    show: boolean;
    placement: Placement;
    align: "start" | "center" | "end";
    /** The backing the name is drawn on; an overlaid name is never `none`. */
    background: "none" | "scrim" | "surface";
    /** The line clamp, `null` for natural height. */
    lines: 1 | 2 | null;
  };
  /** Custom properties for the list root (all values are validated numbers or fixed tokens — never raw input). */
  vars: Record<string, string>;
  /** Columns / widths / gaps per device, for tests, the editor's summary and the `sizes` hint. */
  columns: Record<DisplayDevice, number>;
  gap: Record<DisplayDevice, number>;
  itemWidth: Record<DisplayDevice, number>;
}

function perDevice(
  stored: PerDevice | undefined,
  fallback: Record<DisplayDevice, number>,
): Record<DisplayDevice, number> {
  return {
    mobile: stored?.mobile ?? fallback.mobile,
    tablet: stored?.tablet ?? fallback.tablet,
    desktop: stored?.desktop ?? fallback.desktop,
  };
}

function pickAllowed<T>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== undefined && allowed.includes(value) ? value : fallback;
}

/** Style-implied card fields, overridden by whatever the merchant set explicitly. */
function cardFrame(
  card: DisplayCard | undefined,
  style: CardStyle,
): { borderWidth: number; background: string; shadow: string } {
  const implied =
    style === "none"
      ? { borderWidth: 0, background: "transparent", shadow: "none" }
      : style === "border"
        ? { borderWidth: 1, background: "surface", shadow: "none" }
        : style === "shadow"
          ? { borderWidth: 0, background: "surface", shadow: SOFT_SHADOW }
          : { borderWidth: 0, background: "muted", shadow: "none" };
  return {
    borderWidth: card?.borderWidth ?? implied.borderWidth,
    background:
      BACKGROUND_TOKEN[card?.background ?? implied.background] ??
      BACKGROUND_TOKEN.surface,
    shadow: implied.shadow,
  };
}

function objectPosition(
  position: DisplayImage["position"] | undefined,
  dir: Dir,
): string {
  switch (position) {
    case "top":
      return "center top";
    case "bottom":
      return "center bottom";
    case "start":
      return dir === "rtl" ? "right center" : "left center";
    case "end":
      return dir === "rtl" ? "left center" : "right center";
    default:
      return "center center";
  }
}

export function resolveCategoryDisplay(
  display: CategoryDisplay,
  dir: Dir = "ltr",
): ResolvedCategoryDisplay {
  const layout = display.layout;
  const d = LAYOUT_DEFAULTS[layout];
  const card = display.card;
  const image = display.image;
  const name = display.name;

  const cardStyle = card?.style ?? d.cardStyle;
  const frame = cardFrame(card, cardStyle);

  const imageShown = image?.show !== false;
  // Hiding both leaves a blank link: the name stays.
  const nameShown = name?.show !== false || !imageShown;
  const shape = pickAllowed(
    image?.shape,
    LAYOUT_SHAPES[layout],
    LAYOUT_SHAPES[layout][0],
  );
  const placement = pickAllowed(
    name?.placement,
    LAYOUT_PLACEMENTS[layout],
    LAYOUT_PLACEMENTS[layout][0],
  );
  // An overlaid name needs the scrim (or a themed surface); "none" would put free text on a photo.
  const rawBackground =
    name?.background ?? (placement === "overlay" ? "scrim" : "none");
  const nameBackground =
    placement === "overlay" && rawBackground === "none"
      ? "scrim"
      : rawBackground;

  const columns = perDevice(display.columns, d.columns);
  const gap = perDevice(display.gap, d.gap);
  const itemWidth = perDevice(display.itemWidth, d.itemWidth);
  const scroll = isScrollLayout(layout);
  const heights: Record<DisplayDevice, number | null> = {
    mobile: image?.height?.mobile ?? null,
    tablet: image?.height?.tablet ?? null,
    desktop: image?.height?.desktop ?? null,
  };

  const aspectKey =
    shape === "circle" || shape === "square"
      ? "1:1"
      : (image?.aspect ?? d.aspect);
  const ratio = RATIO[aspectKey] ?? RATIO["4:3"];

  const vars: Record<string, string> = {};
  for (const device of DISPLAY_DEVICES) {
    const k = device[0];
    const height = heights[device];
    vars[`--cd-cols-${k}`] = String(columns[device]);
    vars[`--cd-gap-${k}`] = `${gap[device]}px`;
    vars[`--cd-iw-${k}`] = `${itemWidth[device]}px`;
    vars[`--cd-thumb-${k}`] =
      `${height === null ? d.thumb[device] : clampThumb(height)}px`;
    // The media box: a circle's custom height is its diameter (width), any other shape's is a fixed height that replaces
    // the aspect ratio. Without one the aspect ratio alone reserves the space (no layout shift while the image loads).
    if (shape === "circle") {
      vars[`--cd-ar-${k}`] = "1 / 1";
      vars[`--cd-h-${k}`] = "auto";
      vars[`--cd-w-${k}`] = height === null ? "100%" : `${height}px`;
    } else {
      vars[`--cd-ar-${k}`] = height === null ? ratio : "auto";
      vars[`--cd-h-${k}`] = height === null ? "auto" : `${height}px`;
      vars[`--cd-w-${k}`] = "100%";
    }
  }

  vars["--cd-pad"] = `${card?.padding ?? d.padding}px`;
  vars["--cd-bw"] = `${frame.borderWidth}px`;
  vars["--cd-bc"] =
    BORDER_TOKEN[card?.borderColor ?? "border"] ?? BORDER_TOKEN.border;
  vars["--cd-bg"] = frame.background;
  vars["--cd-bg-hover"] =
    frame.background === "transparent"
      ? "var(--store-surface-muted)"
      : frame.background;
  vars["--cd-radius"] =
    card?.radius !== undefined
      ? `${card.radius}px`
      : "var(--store-radius, 0.75rem)";
  vars["--cd-shadow"] = frame.shadow;
  vars["--cd-fit"] = image?.fit ?? "cover";
  vars["--cd-op"] = objectPosition(image?.position, dir);

  const align = name?.align ?? d.nameAlign;
  const onScrim = nameBackground === "scrim";
  vars["--cd-name-size"] = `${name?.size ?? d.nameSize}px`;
  vars["--cd-name-weight"] = String(name?.weight ?? d.nameWeight);
  vars["--cd-name-align"] =
    align === "center" ? "center" : align === "end" ? "end" : "start";
  vars["--cd-name-justify"] =
    align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start";
  vars["--cd-name-bg"] =
    nameBackground === "scrim"
      ? "var(--store-scrim, rgb(0 0 0 / 0.72))"
      : nameBackground === "surface"
        ? "var(--store-surface)"
        : "transparent";
  vars["--cd-name-color"] = onScrim
    ? "var(--store-scrim-foreground, #fff)"
    : (COLOR_TOKEN[name?.color ?? "foreground"] ?? COLOR_TOKEN.foreground);
  const lines = name?.lines ?? 2;
  vars["--cd-lines"] = lines === "natural" ? "none" : String(lines);

  return {
    layout,
    scroll,
    card: { style: cardStyle, hover: card?.hover === "subtle" },
    image: { show: imageShown, shape, heights },
    name: {
      show: nameShown,
      placement,
      align,
      background: nameBackground,
      lines: lines === "natural" ? null : lines,
    },
    vars,
    columns,
    gap,
    itemWidth,
  };
}

function clampThumb(value: number): number {
  return Math.max(
    COMPACT_THUMB_RANGE[0],
    Math.min(COMPACT_THUMB_RANGE[1], value),
  );
}

/**
 * The `sizes` hint of a category image: one column's share of the viewport per breakpoint (grid layouts) or the fixed
 * item width (scrolling layouts). The breakpoints match the stylesheet's (`640px` tablet, `1024px` desktop).
 */
export function imageSizes(resolved: ResolvedCategoryDisplay): string {
  if (resolved.scroll) {
    const w = resolved.itemWidth;
    return `(min-width: 1024px) ${w.desktop}px, (min-width: 640px) ${w.tablet}px, ${w.mobile}px`;
  }
  const c = resolved.columns;
  return `(min-width: 1024px) ${Math.round(100 / c.desktop)}vw, (min-width: 640px) ${Math.round(100 / c.tablet)}vw, ${Math.round(100 / c.mobile)}vw`;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(hex: string): string {
  if (hex.length !== 4) return hex.toLowerCase();
  const [, r, g, b] = hex;
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

function relativeLuminance(hex: string): number {
  const full = expandHex(hex).slice(1);
  const channels = [0, 2, 4].map((i) => {
    const v = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export interface Swatch {
  background: string;
  /** The initial's colour: white or pure black, whichever contrasts more — always >= 4.5:1 (worst case ~4.58 at mid-grey). */
  foreground: string;
}

/**
 * The stand-in for a category without a picture: the merchant's own colour when it is a plain hex literal (the column
 * is free text that lands in a `style` attribute, so it is validated, not trusted), else `null` — the neutral surface.
 * The foreground is whichever of black / white contrasts more, which is >= 4.5:1 over every colour, so an initial drawn on it is always readable.
 */
export function categorySwatch(
  color: string | null | undefined,
): Swatch | null {
  if (typeof color !== "string" || !HEX.test(color.trim())) return null;
  const hex = expandHex(color.trim());
  const lum = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (lum + 0.05);
  const contrastWithDark = (lum + 0.05) / 0.05; // pure black: luminance 0
  return {
    background: hex,
    foreground: contrastWithWhite >= contrastWithDark ? "#ffffff" : "#000000",
  };
}

/** The first visible character of a name (by code point), for the fallback frame. */
export function categoryInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "";
}
