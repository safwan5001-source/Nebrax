/**
 * CUST-HV V8e — what the published storefront draws for a `gallery` section (V0 §13.2).
 *
 * The server publishes, per image, what the browser may load (`presentation_media`, keyed by the reference's JSON path).
 * This module joins them back to the image. Nothing is guessed: an image whose picture the server did not resolve is
 * omitted (position numbers count what is drawn), and a gallery with no resolvable image is omitted whole.
 *
 * No contrast decision exists here (nothing is drawn over a gallery picture); captions sit on the section surface under
 * the text colour the section frame already resolved.
 */
import type { PresentationHomeSection } from "./config";
import {
  type GalleryOptions,
  type ResolvedGalleryOptions,
  resolveGalleryOptions,
} from "./gallery-content";
import type { ResolvedMedia, ResolvedMediaMap } from "./media-ref";
import { galleryContentOf } from "./section-content";

export function galleryImagePath(
  sectionIndex: number,
  imageIndex: number,
): string {
  return `homepage.sections.${sectionIndex}.content.images.${imageIndex}.media`;
}

export interface GalleryImageView {
  id: string;
  /** 1-based, among the images actually drawn. */
  position: number;
  media: ResolvedMedia;
  focal?: { x: number; y: number };
  fit: "cover" | "contain";
  /** Alt text for the visitor's locale; `""` for a decorative picture. */
  alt: string;
  caption: string;
  /** The merchant's own link (already content-sanitised); the page turns it into a destination. */
  link: string | null;
}

export interface GalleryView {
  images: GalleryImageView[];
  options: ResolvedGalleryOptions;
  layout: "grid" | "carousel";
}

function altFor(media: ResolvedMedia, locale: string): string {
  if (media.decorative) return "";
  return media.alt[locale === "ar" ? "ar" : "en"] ?? "";
}

export function resolveGallery(
  section: PresentationHomeSection,
  sectionIndex: number,
  resolved: ResolvedMediaMap,
  locale: string,
): GalleryView | null {
  const content = galleryContentOf(section);
  const images: GalleryImageView[] = [];

  content.images.forEach((image, imageIndex) => {
    const media = resolved[galleryImagePath(sectionIndex, imageIndex)];
    if (!media) return;
    images.push({
      id: image.id,
      position: images.length + 1,
      media,
      ...(image.media.focal ? { focal: image.media.focal } : {}),
      fit: image.media.fit === "contain" ? "contain" : "cover",
      alt: altFor(media, locale),
      caption: image.caption ?? "",
      link: image.link ?? null,
    });
  });

  if (images.length === 0) return null;
  return {
    images,
    options: resolveGalleryOptions(
      content.options as GalleryOptions | undefined,
    ),
    layout: section.design?.layout === "carousel" ? "carousel" : "grid",
  };
}

/** The `<picture>` sources of a resolved picture: the real rendered widths per format, and the largest JPEG as the fallback. */
export interface PictureData {
  webp: string;
  jpg: string;
  fallback: string;
  width: number;
  height: number;
}

function srcSet(media: ResolvedMedia, format: "webp" | "jpg"): string {
  return media.sources
    .filter((source) => source.kind === "w" && source.format === format)
    .map((source) => `${source.src} ${source.width}w`)
    .join(", ");
}

export function pictureData(media: ResolvedMedia): PictureData {
  const widths = media.sources.filter((source) => source.kind === "w");
  const fallback =
    widths.filter((source) => source.format === "jpg").at(-1) ??
    widths.at(-1) ??
    media.sources[0];
  return {
    webp: srcSet(media, "webp"),
    jpg: srcSet(media, "jpg"),
    fallback: fallback?.src ?? "",
    width: media.width,
    height: media.height,
  };
}
