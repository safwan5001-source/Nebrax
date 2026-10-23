import type { CSSProperties } from "react";
import { MotionPicture } from "@/components/ui/motion-picture";
import { animatedPictureSources } from "@/lib/presentation/animated-sources";
import { destination } from "@/lib/home/destination";
import {
  type GalleryImageView,
  type GalleryView,
  pictureData,
} from "@/lib/presentation/gallery-resolve";
import { GalleryClient, type GalleryLabels } from "./GalleryClient";

export type { GalleryLabels } from "./GalleryClient";

/**
 * CUST-HV V8e (V0 §13.2, D-24) — the published gallery. Server-rendered and complete without JavaScript:
 *
 *  - `grid` is a CSS grid whose column count collapses with the viewport (stylesheet, not script); `carousel` is a native
 *    scroll-snap strip (touch, wheel and keyboard scrolling are the browser's, in the document's direction);
 *  - every picture is a real `<picture>` with its rendered widths; the first row loads eagerly only when the gallery opens
 *    the page, everything else is lazy with its intrinsic size reserved by the aspect-ratio frame;
 *  - an image with a merchant link is a link; otherwise, with the viewer on, it is an anchor to the **large picture file**
 *    (a no-JS visitor simply opens the picture) that `GalleryClient` upgrades to the modal viewer after hydration;
 *  - captions (when switched on) are `<figcaption>`s under the picture, on the section surface.
 *
 * No colour, URL or style from the document reaches the DOM except through validated custom properties and the existing
 * destination / media-proxy rules.
 */

const PHONE_COLUMNS = 2;
function tabletColumns(columns: number): number {
  if (columns === 6) return 4;
  if (columns === 4) return 3;
  return columns;
}

function sizesFor(columns: number): string {
  return `(min-width: 1024px) ${Math.round(100 / columns)}vw, (min-width: 640px) ${Math.round(100 / tabletColumns(columns))}vw, ${Math.round(100 / PHONE_COLUMNS)}vw`;
}

function Picture({
  image,
  sizes,
  eager,
}: {
  image: GalleryImageView;
  sizes: string;
  eager: boolean;
}) {
  const data = pictureData(image.media);
  const position = image.focal
    ? `${image.focal.x}% ${image.focal.y}%`
    : undefined;
  const motion = animatedPictureSources(image.media, undefined, sizes);
  const contents = (
    <>
      {data.webp ? (
        <source type="image/webp" srcSet={data.webp} sizes={sizes} />
      ) : null}
      <img
        src={data.fallback}
        srcSet={data.jpg || undefined}
        sizes={sizes}
        width={data.width}
        height={data.height}
        alt={image.alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        style={
          position ? ({ objectPosition: position } as CSSProperties) : undefined
        }
      />
    </>
  );
  return motion ? (
    <MotionPicture id={image.media.animation!.src} sources={motion} data-gallery-picture="">
      {contents}
    </MotionPicture>
  ) : (
    <picture data-gallery-picture="">{contents}</picture>
  );
}

export function HomeGallery({
  view,
  labels,
  basePath,
  dir,
  priority,
  sectionId,
}: {
  view: GalleryView;
  labels: GalleryLabels;
  basePath: string;
  dir: "ltr" | "rtl";
  /** The gallery opens the page: its first picture is the likely LCP element. */
  priority: boolean;
  sectionId: string;
}) {
  const { images, options, layout } = view;
  const sizes = sizesFor(options.columns);
  const viewerItems = images.map((image) => {
    const data = pictureData(image.media);
    return {
      animation: image.media.animation?.src,
      format: image.media.animation?.format,
      webp: data.webp,
      jpg: data.jpg,
      src: data.fallback,
      width: data.width,
      height: data.height,
      alt: image.alt,
      caption: options.captions ? image.caption : "",
    };
  });

  return (
    <section
      data-gallery=""
      data-layout={layout}
      data-cols={options.columns}
      data-gap={options.gap}
      data-aspect={options.aspect.replace(":", "-")}
      dir={dir}
      aria-label={labels.label}
    >
      <GalleryClient
        labels={labels}
        items={viewerItems}
        layout={layout}
        viewer={options.lightbox}
        dir={dir}
        sectionId={sectionId}
      >
        <ul data-gallery-list="">
          {images.map((image, index) => {
            const href = image.link ? destination(basePath, image.link) : null;
            const openLabel = labels.open.replace(
              "{number}",
              String(image.position),
            );
            const frame = (
              <span data-gallery-frame="" data-fit={image.fit}>
                <Picture
                  image={image}
                  sizes={sizes}
                  eager={priority && index < options.columns}
                />
              </span>
            );
            return (
              <li key={image.id} data-gallery-item="">
                <figure>
                  {href ? (
                    <a
                      href={href}
                      data-gallery-link=""
                      aria-label={
                        image.alt ||
                        image.caption ||
                        labels.item.replace("{number}", String(image.position))
                      }
                      {...(href.startsWith("https://")
                        ? { rel: "noopener noreferrer" }
                        : {})}
                    >
                      {frame}
                    </a>
                  ) : options.lightbox ? (
                    <a
                      href={viewerItems[index].src}
                      data-gallery-open={index}
                      aria-label={
                        image.alt ? `${openLabel}: ${image.alt}` : openLabel
                      }
                    >
                      {frame}
                    </a>
                  ) : (
                    frame
                  )}
                  {options.captions && image.caption ? (
                    <figcaption data-gallery-caption="">
                      {image.caption}
                    </figcaption>
                  ) : null}
                </figure>
              </li>
            );
          })}
        </ul>
      </GalleryClient>
    </section>
  );
}
