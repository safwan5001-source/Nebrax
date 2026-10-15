import Link from "next/link";
import type { CSSProperties } from "react";
import { FacetVisualTile } from "@/components/ui/facet-visual-tile";
import {
  carouselItemWidthPx,
  type DiscoveryItem,
  discoveryColumnVars,
  discoveryLabelHidden,
  discoveryRows,
} from "@/lib/presentation/discovery-items";
import type { ResolvedDiscoveryDisplay } from "@/lib/presentation/discovery-templates";
import type {
  DiscoveryAlign,
  DiscoveryCardStyle,
  DiscoveryGap,
  DiscoveryLayout,
} from "@/lib/presentation/section-content";
import { cn } from "@/lib/utils";

/**
 * AWJ-VD-H1 / VD-4b — the five discovery layouts (`image-grid`, `image-cards`, `carousel`, `icon-grid`, `text-list`).
 *
 * Every item is a real link (the same `products?facet[key]=slug` URL as the legacy tiles) whose accessible name is
 * the value's name — even with `showLabel: false`, where the tile keeps it as `sr-only`. Media is decorative.
 *
 * Layout CSS is static: columns, rows and the carousel item width reach the stylesheet only as custom properties
 * (`--disc-*`) read by fixed arbitrary-value classes and media queries, so no Tailwind class name is built at
 * runtime. Everything uses logical properties (RTL/LTR) and `--store-*` tokens; storefront dark mode is out of scope
 * (D-13).
 */

const GAP: Record<DiscoveryGap, string> = {
  tight: "gap-2",
  normal: "gap-3 md:gap-4",
  loose: "gap-5 md:gap-6",
};

const CARD: Record<DiscoveryCardStyle, string> = {
  plain: "hover:text-store-primary",
  outlined:
    "border border-store-border bg-store-surface hover:border-store-primary hover:text-store-primary",
  elevated:
    "bg-store-surface shadow-md hover:text-store-primary hover:shadow-lg",
  filled: "bg-store-surface-muted hover:text-store-primary",
};

const ALIGN: Record<DiscoveryAlign, string> = {
  center: "items-center text-center",
  start: "items-start text-start",
};

/** Columns per device from `--disc-cols-*`; `sm`/`lg` match the legacy grid's breakpoints. */
const GRID =
  "relative mt-4 grid grid-cols-[repeat(var(--disc-cols-m),minmax(0,1fr))] sm:grid-cols-[repeat(var(--disc-cols-t),minmax(0,1fr))] lg:grid-cols-[repeat(var(--disc-cols-d),minmax(0,1fr))]";

/**
 * Carousel: a native scroll-snap row (no script), so keyboard, touch, trackpad and the scrollbar all work and RTL is
 * the browser's own (the inline-start edge is where it begins). `rows` stacks 1–2 rows on small screens only (§3.7);
 * from `md` up it is one row. Smooth scrolling only when motion is allowed. The padding keeps a focus ring from being
 * clipped by the scroller.
 *
 * Both lists are `relative`: the `sr-only` labels and counts are absolutely positioned, and without a positioned
 * ancestor inside the scroller they would escape its clipping and widen the whole page (found in the harness).
 */
const CAROUSEL =
  "relative -mx-2 mt-1 -mb-3 grid grid-flow-col grid-rows-[repeat(var(--disc-rows),auto)] auto-cols-[var(--disc-item)] overflow-x-auto overscroll-x-contain px-2 py-3 md:grid-rows-1 snap-x snap-mandatory scroll-px-2 [scrollbar-width:thin] motion-safe:scroll-smooth";

const LINK_BASE =
  "group flex min-h-11 w-full min-w-0 rounded-store text-store-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary";

const LINK_LAYOUT: Record<DiscoveryLayout, string> = {
  "image-grid": "flex-col p-2",
  "image-cards": "h-full flex-col gap-2 p-3 md:p-4",
  carousel: "h-full flex-col p-2",
  "icon-grid": "flex-col p-2 md:p-3",
  "text-list": "items-center gap-2 px-4 py-2 text-sm font-bold md:text-base",
};

/**
 * `textPosition: overlay` — the tile's visible caption (its last child, unless it is `sr-only`) sits on the image
 * frame over the `--store-scrim` token, whose pair is contrast-proven for any photo (>= 4.5:1, test-enforced).
 */
const OVERLAY_LABEL =
  "relative w-fit max-w-full [&>span:last-child:not(.sr-only)]:absolute [&>span:last-child:not(.sr-only)]:inset-x-1.5 [&>span:last-child:not(.sr-only)]:rounded-md [&>span:last-child:not(.sr-only)]:bg-store-scrim [&>span:last-child:not(.sr-only)]:px-1.5 [&>span:last-child:not(.sr-only)]:leading-5 [&>span:last-child:not(.sr-only)]:text-center [&>span:last-child:not(.sr-only)]:text-xs [&>span:last-child:not(.sr-only)]:font-semibold [&>span:last-child:not(.sr-only)]:text-store-scrim-foreground";
const OVERLAY_END = "[&>span:last-child:not(.sr-only)]:bottom-1.5";
const OVERLAY_START = "[&>span:last-child:not(.sr-only)]:top-1.5";

/** `textPosition: beside` — frame and caption in a row; the frame yields room to the caption in narrow cells. */
const BESIDE =
  "min-w-0 flex-1 flex-row items-center gap-3 text-start [&>span:first-child]:max-w-[45%]! [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1";

function tileClass(
  item: DiscoveryItem,
  display: ResolvedDiscoveryDisplay,
): string {
  // A frameless (text-by-choice) item has nothing to overlay on or sit beside.
  const framed = item.visual !== null && item.visual.content !== "none";
  const position = framed ? display.textPosition : "below";
  const labelFirst = display.contentSequence === "label-first";
  if (position === "overlay") {
    return cn(OVERLAY_LABEL, labelFirst ? OVERLAY_START : OVERLAY_END);
  }
  if (position === "beside") {
    return cn(BESIDE, labelFirst && "flex-row-reverse");
  }
  return cn("w-full min-w-0", labelFirst && "flex-col-reverse");
}

export function DiscoveryItems({
  layout,
  display,
  items,
  hrefOf,
  idPrefix,
  formatCount,
  describeCount,
}: {
  layout: DiscoveryLayout;
  display: ResolvedDiscoveryDisplay;
  items: DiscoveryItem[];
  hrefOf: (value: string) => string;
  /** Unique per section: prefixes the ids that describe each link's count. */
  idPrefix: string;
  formatCount: (count: number) => string;
  /** The spoken form of a count ("4 products"). */
  describeCount: (count: number) => string;
}) {
  const carousel = layout === "carousel";
  const style = (
    carousel
      ? {
          "--disc-rows": String(discoveryRows(display.rows)),
          "--disc-item": `${carouselItemWidthPx(items)}px`,
        }
      : discoveryColumnVars(display.columns)
  ) as CSSProperties;

  return (
    <ul
      className={cn(carousel ? CAROUSEL : GRID, GAP[display.gap])}
      style={style}
      data-discovery-layout={layout}
      data-discovery-position={
        layout === "text-list" ? undefined : display.textPosition
      }
    >
      {items.map((item, index) => {
        const countId = `${idPrefix}-count-${index}`;
        // A visible count belongs to a visible caption: with the label hidden it would be an unexplained number.
        // Assistive technology still gets it (aria-describedby below).
        const hideName = discoveryLabelHidden(item.visual, item.image);
        const count =
          display.showCounts && !hideName ? (
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0 text-xs font-medium text-store-muted-foreground",
                layout !== "text-list" &&
                  display.textPosition !== "beside" &&
                  "mt-1",
              )}
            >
              {formatCount(item.count)}
            </span>
          ) : null;
        return (
          <li
            key={item.value}
            className={cn("min-w-0", carousel && "snap-start")}
          >
            <Link
              href={hrefOf(item.value)}
              aria-describedby={display.showCounts ? countId : undefined}
              title={hideName ? item.name : undefined}
              className={cn(
                LINK_BASE,
                LINK_LAYOUT[layout],
                layout === "text-list"
                  ? display.align === "center"
                    ? "justify-center text-center"
                    : "justify-start text-start"
                  : display.textPosition === "beside"
                    ? "flex-row items-center"
                    : ALIGN[display.align],
                CARD[display.cardStyle],
              )}
            >
              {item.visual ? (
                <FacetVisualTile
                  visual={item.visual}
                  label={item.name}
                  image={item.image}
                  className={tileClass(item, display)}
                />
              ) : (
                <span
                  className="line-clamp-2 min-w-0 break-words"
                  title={item.name}
                >
                  {item.name}
                </span>
              )}
              {count}
            </Link>
            {display.showCounts ? (
              // Spoken only through the link's aria-describedby: `aria-hidden` keeps it out of the reading order, so
              // it is not announced a second time (a described-by reference still resolves a hidden element).
              <span id={countId} aria-hidden="true" className="sr-only">
                {describeCount(item.count)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
