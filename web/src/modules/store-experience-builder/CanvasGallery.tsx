"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import { type GalleryImage, resolveGalleryOptions, type GalleryOptions } from "./presentation/gallery-content";

/**
 * CUST-HV V8f — the Canvas's twin of the storefront's `HomeGallery`: the SAME `data-gallery` DOM, so the one stylesheet block (kept identical in
 * both stylesheets) styles both. It differs only where an editor must: each picture's URL is the signed workspace preview (`useMediaRefPreview`),
 * the visible column count is the SIMULATED device's (`data-vp`, not a media query against the host window), nothing opens a viewer (a click
 * selects the section, and the editor's selected picture is ringed and kept in view), and an incomplete gallery says what it still needs.
 */
export interface CanvasGalleryLabels {
  label: string;
  empty: string;
  /** `Picture {number}` — the preview picture's name (the real alt text is the merchant's, judged at Publish). */
  item: string;
}

type Viewport = "desktop" | "tablet" | "mobile";

function position(focal?: { x: number; y: number }) {
  return focal ? `${focal.x}% ${focal.y}%` : undefined;
}

function Item({
  image,
  captions,
  selected,
  label,
}: {
  image: GalleryImage;
  captions: boolean;
  selected: boolean;
  label: string;
}) {
  const src = useMediaRefPreview(image.media);
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
              <img src={src} alt={image.media.decorative ? "" : label} decoding="async" style={style} />
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
        <ul data-gallery-list="">
          {images.map((image, index) => (
            <Item
              key={image.id}
              image={image}
              captions={resolved.captions}
              selected={image.id === activeImageId}
              label={labels.item.replace("{number}", String(index + 1))}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
