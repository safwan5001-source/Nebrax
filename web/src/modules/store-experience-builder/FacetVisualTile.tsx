"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ResolvedFacetVisual } from "./presentation/facet-visual";
import {
  FACET_VISUAL_SIZE_PX,
  facetIconBox,
  facetImageStyle,
  facetShapeFrameStyle,
  isFacetHexColor,
  readableIconColor,
} from "./presentation/facet-visual-style";
import { normalizeIconKey } from "./presentation/icon-registry";
import { StoreIcon } from "./StoreIcon";

/** A renderable image source for the tile's media (the caller maps library variants to same-origin URLs). */
export interface FacetVisualTileImage {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * AWJ-VD-H1 / VD-2 — one facet value (or facet) drawn from its **resolved** visual.
 *
 * - The shape masks the media frame only; the tile itself has no card (cards belong to the section layout).
 * - Never shows a broken image: no source or a load error falls back to the resolved `fallbackIcon`, then to the
 *   name's initial, keeping the resolved shape, size and background (D-08). An image that already failed before
 *   hydration (SSR, where React attaches no `onError` in time) is detected on mount.
 * - Only `content: "none"` (text by choice) draws no frame.
 * - The name is always the accessible name: hidden labels stay in the DOM as `sr-only`, and when nothing visual is
 *   left to draw the label is shown regardless of `showLabel`. The image is decorative (`alt=""`) because the name
 *   is already present.
 * - Not a link: the section renderer wraps it, so filtering keeps using the existing `facet[key]=slug` URLs.
 *
 * Admin-preview twin of the storefront tile `storefront/src/components/ui/facet-visual-tile.tsx` (same markup and
 * behaviour, so the editor previews exactly what shoppers see); both read the shared `facet-visual-style.ts`.
 */
export function FacetVisualTile({
  visual,
  label,
  image,
  className,
}: {
  visual: ResolvedFacetVisual;
  label: string;
  image?: FacetVisualTileImage | null;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const imageUsable =
    visual.content === "image" &&
    visual.image !== undefined &&
    !!image?.src &&
    failedSrc !== image.src;
  const src = imageUsable ? image?.src : undefined;

  // An image that failed before hydration never fires React's onError: catch it on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (src && img?.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  // Defensive: a key outside the registry draws no glyph, never markup.
  const iconKey = normalizeIconKey(
    visual.content === "icon"
      ? visual.icon
      : visual.content === "image" && !imageUsable
        ? visual.fallbackIcon
        : undefined,
  );
  const drawsFrame = visual.content !== "none";
  const drawsMedia = imageUsable || iconKey !== undefined;
  const initial = drawsFrame && !drawsMedia ? Array.from(label.trim())[0] : "";
  const labelVisible = visual.showLabel || !drawsMedia;
  const width = FACET_VISUAL_SIZE_PX[visual.size] ?? FACET_VISUAL_SIZE_PX.md;
  const zoom = Math.max(visual.image?.zoom ?? 1, 1);
  const iconColor = readableIconColor(visual.iconColor, visual.background);
  const foreground = iconColor ?? "var(--store-primary, currentColor)";

  return (
    <span
      className={cn(
        "inline-flex flex-col items-center gap-2 text-center",
        className,
      )}
      data-facet-content={
        imageUsable
          ? "image"
          : iconKey
            ? "icon"
            : drawsFrame
              ? "initial"
              : "none"
      }
    >
      {drawsFrame ? (
        <span
          aria-hidden="true"
          className="relative flex shrink-0 items-center justify-center"
          style={{
            ...facetShapeFrameStyle(visual.shape),
            width: `${width}px`,
            maxWidth: "100%",
            background: isFacetHexColor(visual.background)
              ? visual.background
              : "var(--store-muted, var(--store-surface-muted, transparent))",
          }}
        >
          {imageUsable && visual.image && image ? (
            // biome-ignore lint/performance/noImgElement: proxied library variants are pre-sized; next/image would re-encode them.
            <img
              ref={imgRef}
              src={image.src}
              srcSet={image.srcSet}
              sizes={image.sizes ?? `${Math.ceil(width * zoom)}px`}
              alt=""
              width={width}
              height={width}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailedSrc(image.src)}
              style={facetImageStyle(visual.image)}
            />
          ) : iconKey ? (
            <span
              className="flex items-center justify-center"
              style={{
                color: foreground,
                width: facetIconBox(visual.shape),
                height: facetIconBox(visual.shape),
              }}
            >
              <StoreIcon name={iconKey} className="size-full" />
            </span>
          ) : (
            <span
              className="font-semibold leading-none"
              style={{
                color: foreground,
                fontSize: `${Math.round(width * 0.36)}px`,
              }}
            >
              {initial}
            </span>
          )}
        </span>
      ) : null}
      <span
        className={
          labelVisible
            ? "line-clamp-2 max-w-full break-words text-sm font-medium leading-snug"
            : "sr-only"
        }
        title={labelVisible ? label : undefined}
      >
        {label}
      </span>
    </span>
  );
}
