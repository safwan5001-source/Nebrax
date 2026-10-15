/**
 * AWJ-VD-H1 / VD-4b — turns the live discovery values plus the section's resolved display into what the renderer
 * draws. Pure: no React, no I/O, so every rule below is unit-tested without a browser.
 *
 * Per-option visuals use the VD-1a resolver **unchanged** (D-08, one chain per property):
 *   section-explicit shape/size/showLabel  →  the value's own  →  the facet's `defaults`  →  template  →  system.
 * `resolveDiscoveryDisplay` (VD-4a) supplies the `section` and `template` contexts; nothing here re-implements
 * precedence. The render-time fallback (image → icon → text) is the resolver's, and keeps shape and size.
 */

import type {
  DiscoveryOption,
  DiscoveryValues,
} from "@/lib/commerce/data-sections";
import type { ListingFacetImageSource } from "@/lib/commerce/listing-facets";
import type { ResolvedDiscoveryDisplay } from "./discovery-templates";
import {
  type FacetVisualResolution,
  type ResolvedFacetVisual,
  resolveFacetValueVisual,
} from "./facet-visual";
import { FACET_VISUAL_SIZE_PX } from "./facet-visual-style";
import {
  DISCOVERY_COLUMN_RANGES,
  DISCOVERY_MAX_ITEMS_MAX,
  DISCOVERY_MAX_ITEMS_MIN,
  DISCOVERY_ROWS_MAX,
  DISCOVERY_ROWS_MIN,
  type DiscoveryColumns,
  type DiscoveryLayout,
  type DiscoveryValueSort,
} from "./section-content";

/** A renderable image for `FacetVisualTile` (structurally the tile's `image` prop). */
export interface DiscoveryTileImage {
  src: string;
  srcSet?: string;
  sizes?: string;
}

export interface DiscoveryItem {
  /** Facet value slug, or the brand id: the listing deep link is built from it. */
  value: string;
  name: string;
  count: number;
  /** The resolved visual; `null` for `text-list`, which draws no media. */
  visual: ResolvedFacetVisual | null;
  image: DiscoveryTileImage | null;
}

function clampInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
) {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

/**
 * `merchant` keeps the API's order (the merchant's `sort_order`); `count` sorts by count, highest first, with ties
 * kept in the API's order (`Array.prototype.sort` is stable). Never mutates its input.
 */
export function sortDiscoveryOptions<T extends { count: number }>(
  options: readonly T[],
  valueSort: DiscoveryValueSort,
): T[] {
  const copy = [...options];
  return valueSort === "count" ? copy.sort((a, b) => b.count - a.count) : copy;
}

/** The legacy cap was 12; `maxItems` is 4–24 and defaults to 12 (§3.7). */
export function discoveryMaxItems(maxItems: number): number {
  return clampInteger(
    maxItems,
    DISCOVERY_MAX_ITEMS_MIN,
    DISCOVERY_MAX_ITEMS_MAX,
    12,
  );
}

/** Sort, then cap: the options that are drawn, in drawing order. Shared by the legacy and the new renderer. */
export function visibleDiscoveryOptions<T extends { count: number }>(
  options: readonly T[],
  display: Pick<ResolvedDiscoveryDisplay, "valueSort" | "maxItems">,
): T[] {
  return sortDiscoveryOptions(options, display.valueSort).slice(
    0,
    discoveryMaxItems(display.maxItems),
  );
}

// ───────────────────────────── images ─────────────────────────────

/**
 * `src` / `srcSet` for the proxy sources of one image. Width descriptors are the files' real pixel widths (the
 * origin reports them), so the browser picks correctly for the frame and the device pixel ratio. WebP is preferred
 * (every browser that understands `srcset` with `w` descriptors also decodes it); a media with JPEG files only still
 * works. `src` is the fallback for a client that ignores `srcset`: the smallest file that is at least 2× the frame,
 * else the largest. `sizes` is left to the tile, which knows the frame and the zoom.
 */
export function discoveryTileImage(
  sources: readonly ListingFacetImageSource[] | undefined,
  framePx: number,
): DiscoveryTileImage | null {
  if (!sources || sources.length === 0) return null;
  const webp = sources.filter((source) => source.format === "webp");
  const chosen = webp.length > 0 ? webp : sources;
  const byWidth = new Map<number, ListingFacetImageSource>();
  for (const source of chosen)
    if (!byWidth.has(source.width)) byWidth.set(source.width, source);
  const ordered = [...byWidth.values()].sort((a, b) => a.width - b.width);
  const fallback =
    ordered.find((source) => source.width >= framePx * 2) ??
    ordered[ordered.length - 1];
  return {
    src: fallback.src,
    srcSet: ordered
      .map((source) => `${source.src} ${source.width}w`)
      .join(", "),
  };
}

// ───────────────────────────── visuals ─────────────────────────────

/**
 * `content: "none"` means two different things. A value (or its facet) that chose text-only stays frameless. But
 * "nothing set anywhere" (the system default) or "asked for an image or icon that is not available" is a fallback,
 * and D-08 says a fallback keeps shape and size — so those draw the shaped frame with the name's initial, which keeps
 * a grid row aligned. The tile draws the initial for `icon` without a glyph.
 */
function keepsFrame(resolution: FacetVisualResolution): ResolvedFacetVisual {
  const { visual, sources } = resolution;
  const textByChoice =
    visual.content === "none" &&
    sources.content !== "system" &&
    sources.fallback === null;
  return visual.content === "none" && !textByChoice
    ? { ...visual, content: "icon" }
    : visual;
}

/**
 * §3.6 rule 3 — `icon-grid` shows the resolved icon first, then the image, then the text. The resolver ranks an
 * image above its icon; this swaps them for that one layout and leaves every other property alone.
 */
function iconFirst(visual: ResolvedFacetVisual): ResolvedFacetVisual {
  const icon =
    visual.content === "icon"
      ? visual.icon
      : visual.content === "image"
        ? visual.fallbackIcon
        : undefined;
  if (icon === undefined) return visual;
  const { image: _image, fallbackIcon: _fallback, ...rest } = visual;
  return { ...rest, content: "icon", icon };
}

export function resolveDiscoveryOptionVisual(
  option: DiscoveryOption,
  defaults: DiscoveryValues["defaults"],
  display: ResolvedDiscoveryDisplay,
  layout: Exclude<DiscoveryLayout, "text-list">,
): ResolvedFacetVisual {
  const resolution = resolveFacetValueVisual(
    defaults ? { defaults } : {},
    option.visual ?? {},
    {
      section: display.visualSection,
      template: display.visualTemplate,
      // The parser removed any image left without sources, so an image still present here has files to load.
      usableMediaIds:
        option.visual?.image && option.imageSources?.length
          ? [option.visual.image.mediaId]
          : [],
    },
  );
  const visual = keepsFrame(resolution);
  return layout === "icon-grid" ? iconFirst(visual) : visual;
}

export function buildDiscoveryItems(
  values: DiscoveryValues,
  display: ResolvedDiscoveryDisplay & { layout: DiscoveryLayout },
): DiscoveryItem[] {
  const layout = display.layout;
  return visibleDiscoveryOptions(values.options, display).map((option) => {
    if (layout === "text-list") {
      return {
        value: option.value,
        name: option.name,
        count: option.count,
        visual: null,
        image: null,
      };
    }
    const visual = resolveDiscoveryOptionVisual(
      option,
      values.defaults,
      display,
      layout,
    );
    return {
      value: option.value,
      name: option.name,
      count: option.count,
      visual,
      image:
        visual.content === "image"
          ? discoveryTileImage(
              option.imageSources,
              FACET_VISUAL_SIZE_PX[visual.size] ?? FACET_VISUAL_SIZE_PX.md,
            )
          : null,
    };
  });
}

// ───────────────────────────── geometry ─────────────────────────────

/**
 * Columns per device as CSS custom properties. The stylesheet reads them through static classes and media queries
 * (one arbitrary-value class per breakpoint), so no Tailwind class name is ever built at runtime.
 * Re-clamped to the contract ranges at the render boundary.
 */
export function discoveryColumnVars(
  columns: Required<DiscoveryColumns>,
): Record<string, string> {
  const column = (device: keyof typeof DISCOVERY_COLUMN_RANGES) => {
    const [min, max] = DISCOVERY_COLUMN_RANGES[device];
    return String(clampInteger(columns[device], min, max, min));
  };
  return {
    "--disc-cols-m": column("mobile"),
    "--disc-cols-t": column("tablet"),
    "--disc-cols-d": column("desktop"),
  };
}

/** Rows of a carousel: 1–2 (§3.7). */
export function discoveryRows(rows: number): number {
  return clampInteger(rows, DISCOVERY_ROWS_MIN, DISCOVERY_ROWS_MAX, 1);
}

/** Horizontal room around a carousel frame (the link's padding on both sides). */
const CAROUSEL_ITEM_PADDING_PX = 24;
const CAROUSEL_ITEM_MIN_PX = 88;

/**
 * A carousel column is as wide as its largest frame (plus padding), so a `lg` value is never clipped by a `sm`
 * neighbour. Text-only items use the system size.
 */
export function carouselItemWidthPx(items: readonly DiscoveryItem[]): number {
  const widest = items.reduce(
    (max, item) =>
      Math.max(
        max,
        FACET_VISUAL_SIZE_PX[item.visual?.size ?? "md"] ??
          FACET_VISUAL_SIZE_PX.md,
      ),
    0,
  );
  return Math.max(CAROUSEL_ITEM_MIN_PX, widest + CAROUSEL_ITEM_PADDING_PX);
}
