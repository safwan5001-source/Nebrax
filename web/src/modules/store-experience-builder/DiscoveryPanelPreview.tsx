"use client";

/**
 * AWJ-VD-H1 / VD-4c — the live preview inside the discovery controls panel.
 *
 * It draws the section with the **resolved** display (explicit → template → system default, `resolveDiscoveryDisplay`),
 * every tile from the shared facet-visual chain (`resolveFacetValueVisual`, with the section's explicit shape / size /
 * label above the value's own look and the template's below it) through the admin twin of the storefront tile
 * (`FacetVisualTile`). Preview only: it saves nothing and requests nothing; pictures are inline samples.
 *
 * It follows the storefront renderer (VD-4b, `components/home/DiscoveryItems.tsx` + `lib/presentation/discovery-items.ts`)
 * rule for rule:
 *  - columns per device (mobile / `sm` tablet / `lg` desktop) drive the grid layouts only; the carousel ignores them and
 *    sizes each item from its widest frame; a second carousel row exists on mobile only;
 *  - `icon-grid` shows the resolved icon first, then the image, then the name;
 *  - `text-list` draws plain names (no media, no `showLabel`, no text position);
 *  - `overlay` puts the caption on the frame (top with `label-first`), `beside` puts frame and caption in a row;
 *  - a count shows only next to a visible name.
 * Where it cannot be exact (the panel is ~300 px wide, so fonts and gaps are compacted) the caption says the published
 * store is the reference.
 *
 * The frame is the store's own surface (`.awj-store-preview` tokens), not the admin's: a merchant judges the section
 * against the store's colours, and the admin dark mode must not repaint it. It is a picture of the section, not a
 * control: the frame is hidden from assistive technology and holds nothing focusable; the device switcher and the
 * caption, outside it, carry the information.
 */

import { Monitor, Smartphone, Tablet } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Facet } from "@/modules/commerce-workspace/merchandising/client";
import { FacetVisualTile } from "./FacetVisualTile";
import {
  type PreviewValue,
  previewCarouselItemWidth,
  previewCarouselRows,
  previewSelection,
  previewSource,
  previewValueVisual,
} from "./discovery-preview-model";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";
import { resolveDiscoveryDisplay } from "./presentation/discovery-templates";
import {
  type ResolvedFacetVisual,
  resolveFacetValueVisual,
} from "./presentation/facet-visual";
import { FACET_VISUAL_SIZE_PX } from "./presentation/facet-visual-style";
import type { DiscoveryContent, DiscoveryGap } from "./presentation/section-content";
import "./store-preview.css";

type T = (key: CustomizerMessageKey) => string;
type Device = "mobile" | "tablet" | "desktop";

const DEVICES: ReadonlyArray<{
  id: Device;
  key: "ddDevice_mobile" | "ddDevice_tablet" | "ddDevice_desktop";
  Icon: typeof Monitor;
}> = [
  { id: "mobile", key: "ddDevice_mobile", Icon: Smartphone },
  { id: "tablet", key: "ddDevice_tablet", Icon: Tablet },
  { id: "desktop", key: "ddDevice_desktop", Icon: Monitor },
];

/** The simulated device's width: a wide panel must not stretch a mobile preview across a desktop-sized frame. */
const DEVICE_MAX_WIDTH: Record<Device, string | undefined> = {
  mobile: "24rem",
  tablet: "42rem",
  desktop: undefined,
};

/** The storefront's `gap-2` / `gap-3 md:gap-4` / `gap-5 md:gap-6`; tablet and desktop are both `md` and up. */
const GAP_REM: Record<DiscoveryGap, { mobile: string; wide: string }> = {
  tight: { mobile: "0.5rem", wide: "0.5rem" },
  normal: { mobile: "0.75rem", wide: "1rem" },
  loose: { mobile: "1.25rem", wide: "1.5rem" },
};

/** The storefront's `--store-scrim` pair (the admin store sheet does not define it). */
const SCRIM_VARS = {
  "--store-scrim": "rgb(0 0 0 / 0.72)",
  "--store-scrim-foreground": "rgb(255 255 255)",
} as CSSProperties;

/** A small inline picture (no network, no media-library request); hue varies per sample. */
function samplePicture(index: number): string {
  const hue = (index * 47 + 12) % 360;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${hue},55%,76%)'/>` +
    `<stop offset='1' stop-color='hsl(${(hue + 40) % 360},50%,54%)'/></linearGradient></defs>` +
    `<rect width='80' height='80' fill='url(#g)'/>` +
    `<circle cx='56' cy='26' r='10' fill='hsl(${hue},70%,92%)' opacity='.75'/>` +
    `<path d='M0 80 L26 46 L46 66 L60 52 L80 80Z' fill='hsl(${hue},38%,34%)' opacity='.5'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Storefront `textPosition: overlay`: the tile's visible caption sits on the frame over the scrim. */
const OVERLAY_LABEL =
  "relative w-fit max-w-full [&>span:last-child:not(.sr-only)]:absolute [&>span:last-child:not(.sr-only)]:inset-x-1.5 [&>span:last-child:not(.sr-only)]:rounded-md [&>span:last-child:not(.sr-only)]:bg-[var(--store-scrim)] [&>span:last-child:not(.sr-only)]:px-1.5 [&>span:last-child:not(.sr-only)]:leading-5 [&>span:last-child:not(.sr-only)]:text-center [&>span:last-child:not(.sr-only)]:text-xs [&>span:last-child:not(.sr-only)]:font-semibold [&>span:last-child:not(.sr-only)]:text-[var(--store-scrim-foreground)]";
const OVERLAY_END = "[&>span:last-child:not(.sr-only)]:bottom-1.5";
const OVERLAY_START = "[&>span:last-child:not(.sr-only)]:top-1.5";
/** Storefront `textPosition: beside`: frame and caption in a row; the frame yields room to the caption. */
const BESIDE =
  "min-w-0 flex-1 flex-row items-center gap-3 text-start [&>span:first-child]:!max-w-[45%] [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1";

const CARD: Record<NonNullable<DiscoveryContent["cardStyle"]>, string> = {
  plain: "",
  outlined: "border border-store-border bg-store-surface",
  elevated: "bg-store-surface shadow-md",
  filled: "bg-store-surface-muted",
};

/** The same padding per layout as the storefront link (`LINK_LAYOUT`); `wide` is `md` and up. */
function linkLayoutClass(layout: string, wide: boolean): string {
  switch (layout) {
    case "image-cards":
      return cn("h-full flex-col gap-2", wide ? "p-4" : "p-3");
    case "icon-grid":
      return cn("flex-col", wide ? "p-3" : "p-2");
    case "text-list":
      return "items-center gap-2 px-4 py-2 text-sm font-bold";
    default:
      return "flex-col p-2";
  }
}

/** A value drawn "text by choice" never reaches here; "nothing anywhere" falls back to a shaped frame with the initial. */
function keepsFrame(visual: ResolvedFacetVisual): ResolvedFacetVisual {
  return visual.content === "none" ? { ...visual, content: "icon" } : visual;
}

function PreviewItem({
  value,
  content,
  layout,
  wide,
  dense,
}: {
  value: PreviewValue;
  content: DiscoveryContent;
  layout: "image-grid" | "image-cards" | "carousel" | "icon-grid" | "text-list";
  wide: boolean;
  /** Four or more columns in a narrow panel: a smaller label keeps words whole. */
  dense: boolean;
}) {
  const display = resolveDiscoveryDisplay(content);

  if (layout === "text-list") {
    return (
      <li data-preview-item="" className="min-w-0">
        <span
          className={cn(
            "flex w-full min-w-0 rounded-store text-store-foreground",
            linkLayoutClass(layout, wide),
            display.align === "center" ? "justify-center text-center" : "justify-start text-start",
            CARD[display.cardStyle],
          )}
        >
          <span className="line-clamp-2 min-w-0 break-words" title={value.label}>
            {value.label}
          </span>
          {display.showCounts ? (
            <span className="shrink-0 text-xs font-medium text-store-muted-foreground" dir="ltr">
              {value.count}
            </span>
          ) : null}
        </span>
      </li>
    );
  }

  const resolution = resolveFacetValueVisual(
    null,
    previewValueVisual(value, layout === "icon-grid"),
    { section: display.visualSection, template: display.visualTemplate },
  );
  const visual = keepsFrame(resolution.visual);
  const picture =
    visual.content === "image" && value.media === "picture"
      ? { src: samplePicture(value.picture) }
      : null;

  const framed = visual.content !== "none";
  const position = framed ? display.textPosition : "below";
  const labelFirst = display.contentSequence === "label-first";
  const tileClass =
    position === "overlay"
      ? cn(OVERLAY_LABEL, labelFirst ? OVERLAY_START : OVERLAY_END)
      : position === "beside"
        ? cn(BESIDE, labelFirst && "flex-row-reverse")
        : cn("w-full min-w-0", labelFirst && "flex-col-reverse");
  // A count belongs to a visible caption (VD-4b).
  const countVisible = display.showCounts && visual.showLabel;

  return (
    <li data-preview-item="" className={cn("min-w-0", layout === "carousel" && "snap-start")}>
      <span
        className={cn(
          "flex w-full min-w-0 rounded-store text-store-foreground",
          linkLayoutClass(layout, wide),
          display.textPosition === "beside" ? "flex-row items-center" : display.align === "center" ? "items-center text-center" : "items-start text-start",
          CARD[display.cardStyle],
        )}
      >
        <FacetVisualTile
          visual={visual}
          label={value.label}
          image={picture}
          className={cn(
            tileClass,
            dense ? "[&_.line-clamp-2]:text-[10px]" : "[&_.line-clamp-2]:text-[11px]",
          )}
        />
        {countVisible ? (
          <span
            className={cn(
              "shrink-0 text-xs font-medium text-store-muted-foreground",
              display.textPosition !== "beside" && "mt-1",
            )}
            dir="ltr"
          >
            {value.count}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function DiscoveryPanelPreview({
  content,
  locale,
  t,
  facets,
  storeVars,
}: {
  /** The section as the panel currently holds it (incomplete facet selections included). */
  content: DiscoveryContent;
  locale: CustomizerLocale;
  t: T;
  facets: readonly Facet[] | null;
  /** The store's theme variables (primary, radius …), as the canvas applies them. */
  storeVars?: CSSProperties;
}) {
  const [device, setDevice] = useState<Device>("mobile");
  const display = resolveDiscoveryDisplay(content);
  const source = useMemo(
    () =>
      previewSource({
        facets,
        axis: content.axis,
        dimension: content.dimension ?? "",
        locale,
      }),
    [facets, content.axis, content.dimension, locale],
  );
  const { shown, hidden } = previewSelection(
    source.values,
    display.valueSort,
    display.maxItems,
  );

  const layout = display.layout;
  const wide = device !== "mobile";
  const columns = display.columns[device];
  const rows = previewCarouselRows(display.rows, device);
  const gap = GAP_REM[display.gap][wide ? "wide" : "mobile"];
  const title = content.title.trim() || t("ddPreviewTitleFallback");
  const dense = layout !== "carousel" && columns >= 4;

  let body: ReactNode;
  if (layout === null) {
    // Legacy look (no layout anywhere): tiles = bordered cards, chips = pills.
    body = (
      <>
        <ul
          className={cn(content.display === "chips" ? "flex flex-wrap" : "grid grid-cols-2")}
          style={{ gap }}
        >
          {shown.map((value) => (
            <li
              key={value.id}
              data-preview-item=""
              className={cn(
                "min-w-0 text-store-foreground",
                content.display === "chips"
                  ? "rounded-full border border-store-border-strong px-3 py-1 text-xs"
                  : "rounded-store border border-store-border bg-store-surface px-3 py-3 text-center text-sm font-medium",
              )}
            >
              <span className="line-clamp-2 break-words">{value.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-store-muted-foreground">{t("ddPreviewLegacy")}</p>
      </>
    );
  } else {
    const items = shown.map((value) => (
      <PreviewItem key={value.id} value={value} content={content} layout={layout} wide={wide} dense={dense} />
    ));
    if (layout === "carousel") {
      const frames = shown.map(() => FACET_VISUAL_SIZE_PX[display.visualSection.size ?? display.visualTemplate.size ?? "md"]);
      body = (
        <ul
          data-preview-rail=""
          className="grid snap-x snap-mandatory grid-flow-col overflow-x-auto pb-2"
          style={{
            gap,
            gridTemplateRows: `repeat(${rows}, auto)`,
            gridAutoColumns: `${previewCarouselItemWidth(frames)}px`,
          }}
        >
          {items}
        </ul>
      );
    } else {
      body = (
        <ul className="grid" style={{ gap, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {items}
        </ul>
      );
    }
  }

  return (
    <div className="space-y-2" data-discovery-preview="">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold text-text">{t("ddPreview")}</h4>
        <div role="group" aria-label={t("ddPreviewDevice")} className="flex border border-border p-0.5">
          {DEVICES.map(({ id, key, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={device === id}
              aria-label={t(key)}
              title={t(key)}
              onClick={() => setDevice(id)}
              className={cn(
                "inline-flex size-11 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                device === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:bg-primary-soft hover:text-primary",
              )}
            >
              <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* A picture of the section, not a control: hidden from assistive technology, nothing focusable inside. */}
      <div
        aria-hidden="true"
        className="awj-store-preview mx-auto overflow-hidden rounded-md border border-border p-3"
        dir={locale === "ar" ? "rtl" : "ltr"}
        style={{ ...storeVars, ...SCRIM_VARS, maxWidth: DEVICE_MAX_WIDTH[device] }}
        data-preview-layout={layout ?? "legacy"}
        data-preview-device={device}
        data-preview-columns={layout === null || layout === "carousel" ? "" : String(columns)}
        data-preview-rows={layout === "carousel" ? String(rows) : ""}
      >
        <div data-preview-title="" className="mb-2 break-words text-sm font-semibold text-store-foreground">
          {title}
        </div>
        {body}
        {hidden > 0 ? (
          <p className="mt-2 text-[11px] text-store-muted-foreground" data-preview-hidden="">
            +{hidden} {t("ddPreviewMore")}
          </p>
        ) : null}
      </div>

      <p className="text-[11px] leading-4 text-muted">
        {layout === null ? null : (
          <span data-preview-summary="">
            {layout === "carousel"
              ? `${t("ddPreviewRows")}: ${rows}${display.rows > 1 && rows === 1 ? ` (${t("ddPreviewRowsMobileOnly")})` : ""}`
              : `${t("ddPreviewColumns")}: ${columns}`}
            {" · "}
          </span>
        )}
        {source.kind === "real" ? t("ddPreviewReal") : t("ddPreviewSample")}. {t("ddPreviewApprox")}
      </p>
    </div>
  );
}
