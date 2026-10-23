"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedPreview } from "./media/animated-preview-store";
import { CanvasMotionToggle, type CanvasMotionLabels, usePrefersReducedMotion } from "./media/CanvasMotion";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import { type GalleryImage, resolveGalleryOptions, type GalleryOptions } from "./presentation/gallery-content";

/**
 * CUST-HV V8f — the Canvas's twin of the storefront's `HomeGallery`: the SAME `data-gallery` DOM, so the one stylesheet block (kept identical in
 * both stylesheets) styles both. It differs only where an editor must: each picture's URL is the signed workspace preview (`useMediaRefPreview`),
 * the visible column count is the SIMULATED device's (`data-vp`, not a media query against the host window), nothing opens a viewer (a click
 * selects the section, and the editor's selected picture is ringed and kept in view), and an incomplete gallery says what it still needs.
 *
 * AWJ-ANIMATED-MEDIA — an animated GIF / WebP picture plays here as on the published page (the SAME `<picture><img>`, `src` swapped to the
 * signed sanitised animation; the still is the default for reduced motion and after it settles), under the SAME policy as the storefront
 * (WCAG 2.2.2): with `showMotionControls` the gallery's one pause / play control (`data-gallery-motion`) drives every animated picture;
 * without it no control is drawn and each animated picture plays `MOTION_BUDGET_MS` then settles on its still. The editor cannot read the
 * file's loop metadata, so it applies the window to every animated picture (the storefront exempts a short play-once file).
 */
export interface CanvasGalleryLabels {
  label: string;
  empty: string;
  /** `Picture {number}` — the preview picture's name (the real alt text is the merchant's, judged at Publish). */
  item: string;
  /** The motion control's names — optional so a caller that predates animated media renders as before. */
  motion?: CanvasMotionLabels;
}

/** Mirrors the storefront's `MOTION_BUDGET_MS` (`lib/presentation/animated-sources.ts`). */
export const CANVAS_MOTION_BUDGET_MS = 5000;

type Viewport = "desktop" | "tablet" | "mobile";

function position(focal?: { x: number; y: number }) {
  return focal ? `${focal.x}% ${focal.y}%` : undefined;
}

function Item({
  image,
  captions,
  selected,
  label,
  playing,
  controls,
  onMotion,
}: {
  image: GalleryImage;
  captions: boolean;
  selected: boolean;
  label: string;
  /** The gallery's shared pause state (meaningful only with `controls`). */
  playing: boolean;
  /** `showMotionControls`: a visible control exists, so no bounded window applies. */
  controls: boolean;
  /** Tells the gallery whether this picture is animated (it owns the one shared control). */
  onMotion: (imageId: string, animated: boolean) => void;
}) {
  const still = useMediaRefPreview(image.media);
  const motion = useAnimatedPreview(image.media.mediaId);
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const animated = !!motion;
  useEffect(() => {
    onMotion(image.id, animated);
    return () => onMotion(image.id, false);
  }, [image.id, animated, onMotion]);
  const errored = !!motion && failed === motion;
  const window = !controls && !!motion && settled === motion; // the bounded window is spent
  const live = !!motion && !reduced && !errored && !window && (!controls || playing);
  useEffect(() => {
    if (controls || !live || !motion) return;
    const timer = setTimeout(() => setSettled(motion), CANVAS_MOTION_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [controls, live, motion]);
  const src = live ? motion : still;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // the editor's selection stays in view (a strip scrolls to it; the page does not jump)
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);
  const style = position(image.media.focal) ? ({ objectPosition: position(image.media.focal) } as CSSProperties) : undefined;
  return (
    <li ref={ref} data-gallery-item="" data-selected={selected ? "" : undefined} data-image-id={image.id} aria-current={selected ? "true" : undefined}>
      <figure>
        <span data-gallery-frame="" data-fit={image.media.fit === "contain" ? "contain" : "cover"}>
          {src ? (
            <picture data-gallery-picture="">
              {/* biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import */}
              <img
                src={src}
                alt={image.media.decorative ? "" : label}
                decoding="async"
                style={style}
                // a stale signature (they last 20 min) must not leave a broken picture: fall back to the still
                onError={live ? () => setFailed(motion) : undefined}
              />
            </picture>
          ) : null}
        </span>
        {captions && image.caption ? <figcaption data-gallery-caption="">{image.caption}</figcaption> : null}
      </figure>
    </li>
  );
}

export function CanvasGallery({
  images,
  options,
  layout,
  dir,
  viewport,
  labels,
  activeImageId,
}: {
  images: GalleryImage[];
  options: GalleryOptions | undefined;
  layout: "grid" | "carousel";
  dir: "ltr" | "rtl";
  viewport: Viewport;
  labels: CanvasGalleryLabels;
  /** The picture the editor has selected; ringed and kept in view. */
  activeImageId?: string | null;
}) {
  const resolved = resolveGalleryOptions(options);
  const reduced = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(true);
  const [animatedIds, setAnimatedIds] = useState<ReadonlySet<string>>(new Set());
  const onMotion = useCallback((imageId: string, isAnimated: boolean) => {
    setAnimatedIds((previous) => {
      if (previous.has(imageId) === isAnimated) return previous;
      const next = new Set(previous);
      if (isAnimated) next.add(imageId);
      else next.delete(imageId);
      return next;
    });
  }, []);
  const showToggle = resolved.showMotionControls && animatedIds.size > 0 && !reduced && !!labels.motion;

  if (images.length === 0) {
    return (
      <section data-gallery-empty="" className="rounded-store border border-dashed border-store-border-strong bg-store-surface px-4 py-5">
        <p className="text-xs text-store-muted-foreground">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section
      data-gallery=""
      data-vp={viewport}
      data-layout={layout}
      data-cols={resolved.columns}
      data-gap={resolved.gap}
      data-aspect={resolved.aspect.replace(":", "-")}
      dir={dir}
      aria-label={labels.label}
    >
      <div data-gallery-root="">
        {showToggle && labels.motion ? (
          <div data-gallery-motion="">
            <CanvasMotionToggle playing={playing} onToggle={() => setPlaying((value) => !value)} labels={labels.motion} />
          </div>
        ) : null}
        <ul data-gallery-list="">
          {images.map((image, index) => (
            <Item
              key={image.id}
              image={image}
              captions={resolved.captions}
              selected={image.id === activeImageId}
              label={labels.item.replace("{number}", String(index + 1))}
              playing={playing}
              controls={resolved.showMotionControls}
              onMotion={onMotion}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
