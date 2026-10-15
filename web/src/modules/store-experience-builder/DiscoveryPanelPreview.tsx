"use client";

/**
 * AWJ-VD-H1 / VD-4c — the live preview inside the discovery controls panel.
 *
 * It draws the section with the **resolved** display (explicit → template → system default, `resolveDiscoveryDisplay`),
 * every tile from the shared facet-visual chain (`resolveFacetValueVisual`, with the section's explicit shape / size /
 * label above the value's own look and the template's below it) through the admin twin of the storefront tile
 * (`FacetVisualTile`). Preview only: it saves nothing and requests nothing; pictures are inline samples.
 *
 * The frame is the store's own surface (`.awj-store-preview` tokens), not the admin's: a merchant judges the section
 * against the store's colours, and the admin dark mode must not repaint it. The preview is an approximation of the
 * published renderer (the storefront owns the exact markup); it never invents commerce facts — value names are the
 * merchant's real facet values or obviously-sample occasions, and the caption says which.
 */

import { Monitor, Smartphone, Tablet } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Facet } from "@/modules/commerce-workspace/merchandising/client";
import { FacetVisualTile } from "./FacetVisualTile";
import {
  type PreviewValue,
  previewSelection,
  previewSource,
  previewValueVisual,
} from "./discovery-preview-model";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";
import { resolveDiscoveryDisplay } from "./presentation/discovery-templates";
import { resolveFacetValueVisual } from "./presentation/facet-visual";
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

const GAP_REM: Record<DiscoveryGap, string> = {
  tight: "0.375rem",
  normal: "0.75rem",
  loose: "1.25rem",
};

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

/** The label of a tile whose position the layout decides: pulled out of the flow over the media's bottom edge. */
const OVERLAY_LABEL =
  "relative [&>span:last-child]:absolute [&>span:last-child]:inset-x-0 [&>span:last-child]:bottom-0 [&>span:last-child]:bg-[color-mix(in_srgb,var(--store-foreground)_68%,transparent)] [&>span:last-child]:rounded-b-lg [&>span:last-child]:px-1 [&>span:last-child]:py-1 [&>span:last-child]:text-[var(--store-surface)]";

function cardClass(style: NonNullable<DiscoveryContent["cardStyle"]>, tight: boolean): string {
  const pad = tight ? "p-1" : "p-2";
  switch (style) {
    case "outlined":
      return `rounded-store border border-store-border-strong ${pad}`;
    case "elevated":
      return `rounded-store bg-store-surface ${pad} shadow-md`;
    case "filled":
      return `rounded-store bg-store-surface-muted ${pad}`;
    default:
      return "";
  }
}

function PreviewTile({
  value,
  content,
  forceIcon,
  medialess,
  fillMedia,
  dense,
}: {
  value: PreviewValue;
  content: DiscoveryContent;
  forceIcon: boolean;
  medialess: boolean;
  /** Cards: the media fills the card's width instead of keeping the size step's fixed width. */
  fillMedia: boolean;
  /** Four or more columns in a narrow panel: a smaller label keeps words whole. */
  dense: boolean;
}) {
  const display = resolveDiscoveryDisplay(content);
  const { visual } = resolveFacetValueVisual(
    null,
    medialess ? { content: "none" } : previewValueVisual(value, forceIcon),
    { section: display.visualSection, template: display.visualTemplate },
  );
  const picture =
    !medialess && !forceIcon && value.media === "picture"
      ? { src: samplePicture(value.picture) }
      : null;

  const overlay = display.textPosition === "overlay" && !medialess;
  const beside = display.textPosition === "beside" || medialess;
  const labelFirst = display.contentSequence === "label-first";
  const direction = beside
    ? labelFirst
      ? "flex-row-reverse"
      : "flex-row"
    : labelFirst
      ? "flex-col-reverse"
      : "flex-col";

  return (
    <span className={cn("inline-flex max-w-full flex-col items-center gap-0.5 text-store-foreground", fillMedia && "w-full")}>
      <FacetVisualTile
        visual={visual}
        label={value.label}
        image={picture}
        className={cn(
          "max-w-full text-store-foreground",
          dense ? "[&_.line-clamp-2]:text-[10px]" : "[&_.line-clamp-2]:text-[11px]",
          direction,
          beside && "items-center text-start",
          overlay && OVERLAY_LABEL,
          fillMedia && "w-full [&>span:first-child]:!w-full",
        )}
      />
      {display.showCounts ? (
        <span className="text-[10px] leading-none text-store-muted-foreground" dir="ltr">
          {value.count}
        </span>
      ) : null}
    </span>
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
  const columns = display.columns[device];
  const gap = GAP_REM[display.gap];
  const title = content.title.trim() || t("ddPreviewTitleFallback");
  const align = display.align === "start" ? "justify-items-start" : "justify-items-center";
  const card = cardClass(display.cardStyle, layout === "icon-grid");
  const tileProps = (value: PreviewValue) => ({
    value,
    content,
    forceIcon: layout === "icon-grid",
    medialess: layout === "text-list",
    fillMedia: layout === "image-cards",
    dense: columns >= 4 && layout !== "carousel",
  });

  const itemCells = shown.map((value) => (
    <li
      key={value.id}
      data-preview-item=""
      className={cn(
        "flex min-w-0 max-w-full",
        layout === "image-cards" || layout === "text-list" ? "w-full" : "",
        layout === "carousel" ? "snap-start" : "",
        display.align === "start" ? "justify-start" : "justify-center",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 max-w-full",
          card,
          (layout === "image-cards" || layout === "text-list") && "w-full",
          display.align === "start" ? "justify-start" : "justify-center",
        )}
      >
        <PreviewTile {...tileProps(value)} />
      </span>
    </li>
  ));

  let body: ReactNode;
  if (layout === null) {
    // Legacy look (no layout anywhere): tiles = bordered cards, chips = pills.
    body = (
      <>
        <ul
          className={cn(
            content.display === "chips" ? "flex flex-wrap" : "grid grid-cols-2",
          )}
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
  } else if (layout === "carousel") {
    body = (
      <ul
        tabIndex={0}
        aria-label={t("ddLayout_carousel")}
        data-preview-rail=""
        className="grid snap-x snap-mandatory overflow-x-auto pb-2"
        style={{
          gap,
          gridAutoFlow: "column",
          gridTemplateRows: `repeat(${display.rows}, auto)`,
          gridAutoColumns: `calc((100% - ${gap} * ${Math.max(columns - 1, 0)}) / ${columns})`,
        }}
      >
        {itemCells}
      </ul>
    );
  } else {
    body = (
      <ul
        className={cn("grid", align)}
        style={{ gap, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {itemCells}
      </ul>
    );
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
                "inline-flex size-11 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:size-9",
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

      <div
        className="awj-store-preview mx-auto overflow-hidden rounded-md border border-border p-3"
        dir={locale === "ar" ? "rtl" : "ltr"}
        style={{ ...storeVars, maxWidth: DEVICE_MAX_WIDTH[device] }}
        data-preview-layout={layout ?? "legacy"}
        data-preview-device={device}
        data-preview-columns={layout === null ? "" : String(columns)}
        data-preview-rows={layout === "carousel" ? String(display.rows) : ""}
      >
        <h5 className="mb-2 break-words text-sm font-semibold text-store-foreground">{title}</h5>
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
            {t("ddPreviewColumns")}: {columns}
            {layout === "carousel" ? ` · ${t("ddPreviewRows")}: ${display.rows}` : ""}
            {" · "}
          </span>
        )}
        {source.kind === "real" ? t("ddPreviewReal") : t("ddPreviewSample")}. {t("ddPreviewApprox")}
      </p>
    </div>
  );
}
