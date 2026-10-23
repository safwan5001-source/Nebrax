/**
 * CUST-HV V8d — `gallery` section content (V0 §13.2, D-24). Byte-identical in web and
 * storefront, pinned to the PHP authority `StorefrontGalleryNormalizer` /
 * `GalleryPublishRules` by the shared fixture `tests/Fixtures/presentation/gallery.json`.
 *
 *   content = { images: Image[≤24 stored, ≥2 to publish], options?: Options }
 *   Image   = { id, media: MediaRef, caption?: string, link?: string }
 *   Options = { columns?: 2|4|6, aspect?: "4:3"|"16:9"|"4:5", gap?: "none"|"xs"|"sm"|"lg"|"xl", captions?: true, lightbox?: true, showMotionControls?: true }
 *
 * The layout `grid | carousel` lives in `design.layout` (V0 §3.4): absent = grid, only `carousel` is stored.
 *
 * AWJ decisions (what V0 left open — not contract changes):
 *  - An image keeps its whole `MediaRef` (alt / decorative / framing / `fit`): no text is drawn over
 *    it, so `contain` cannot invalidate any luminance proof, and the per-locale alt rule is the
 *    generic media Publish gate's (AMEND-10 / AMEND-14), no new path.
 *  - Options store only what differs from the default (3 columns, 1:1, gap `md`, no captions, no
 *    lightbox) so equivalent documents match literally. Unknown keys drop one by one; an image
 *    without a usable media reference drops whole.
 *  - `showMotionControls` (AWJ-ANIMATED-MEDIA; gallery-only): stored only as `true`, so no legacy document gains a key and no
 *    published byte changes. Absent = no visible pause button, and the storefront then caps animated pictures to a bounded
 *    play window (WCAG 2.2.2); `true` shows ONE pause/play control for the whole gallery. Meaningless without an animated picture.
 *  - A caption is text in the store's language (like slide headings): kept as written (code-point
 *    truncated; the editor re-normalises on every keystroke), whitespace alone is absence. It is
 *    always kept — switching `captions` off does not lose it — and drawn only when `captions` is on.
 *  - A link goes through the shared content-href sanitiser. With `lightbox`, an image that has a
 *    link stays a link (the merchant's explicit choice); the others open the viewer.
 *  - No CSS-column masonry and no collage (both deferred in V0): the contract has no key for them.
 */

import type { MediaRef } from "./media-ref";
import { normalizeMediaRef } from "./media-ref";

export const MAX_GALLERY_IMAGES = 24;
export const MIN_GALLERY_IMAGES_TO_PUBLISH = 2;
export const MAX_GALLERY_CAPTION_LENGTH = 120;
export const GALLERY_COLUMNS = [2, 3, 4, 6] as const;
export const GALLERY_DEFAULT_COLUMNS = 3;
export const GALLERY_ASPECTS = ["1:1", "4:3", "16:9", "4:5"] as const;
export const GALLERY_DEFAULT_ASPECT = "1:1";
export const GALLERY_GAPS = ["none", "xs", "sm", "md", "lg", "xl"] as const;
export const GALLERY_DEFAULT_GAP = "md";

export type GalleryColumns = (typeof GALLERY_COLUMNS)[number];
export type GalleryAspect = (typeof GALLERY_ASPECTS)[number];
export type GalleryGap = (typeof GALLERY_GAPS)[number];

export interface GalleryImage {
  id: string;
  media: MediaRef;
  caption?: string;
  link?: string;
}

/** Only values that differ from the default are ever stored. */
export interface GalleryOptions {
  columns?: Exclude<GalleryColumns, 3>;
  aspect?: Exclude<GalleryAspect, "1:1">;
  gap?: Exclude<GalleryGap, "md">;
  captions?: true;
  lightbox?: true;
  showMotionControls?: true;
}

export interface GalleryContent {
  images: GalleryImage[];
  options?: GalleryOptions;
}

/** The options with every default made explicit — what a renderer reads. */
export interface ResolvedGalleryOptions {
  columns: GalleryColumns;
  aspect: GalleryAspect;
  gap: GalleryGap;
  captions: boolean;
  lightbox: boolean;
  showMotionControls: boolean;
}

export function resolveGalleryOptions(
  options: GalleryOptions | undefined,
): ResolvedGalleryOptions {
  return {
    columns: options?.columns ?? GALLERY_DEFAULT_COLUMNS,
    aspect: options?.aspect ?? GALLERY_DEFAULT_ASPECT,
    gap: options?.gap ?? GALLERY_DEFAULT_GAP,
    captions: options?.captions === true,
    lightbox: options?.lightbox === true,
    showMotionControls: options?.showMotionControls === true,
  };
}

const PHP_TRIM_CHARS = new Set([" ", "\t", "\n", "\r", "\0", "\x0B"]);

function phpTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && PHP_TRIM_CHARS.has(value[start])) start += 1;
  while (end > start && PHP_TRIM_CHARS.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || phpTrim(value) === "") return "";
  return Array.from(value).slice(0, max).join("");
}

function normalizeImage(
  raw: Record<string, unknown>,
  index: number,
  sanitizeHref: (value: string) => string,
): GalleryImage | null {
  const media = normalizeMediaRef(raw.media);
  if (!media) return null;

  const rawId = typeof raw.id === "string" ? phpTrim(raw.id) : "";
  const id = /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : `image-${index}`;

  const image: GalleryImage = { id, media };
  const caption = text(raw.caption, MAX_GALLERY_CAPTION_LENGTH);
  if (caption !== "") image.caption = caption;
  const link = sanitizeHref(typeof raw.link === "string" ? raw.link : "");
  if (link !== "") image.link = link;
  return image;
}

function normalizeOptions(raw: unknown): GalleryOptions {
  if (!isRecord(raw)) return {};
  const out: GalleryOptions = {};
  const columns = raw.columns;
  if (
    typeof columns === "number" &&
    (GALLERY_COLUMNS as readonly number[]).includes(columns) &&
    columns !== GALLERY_DEFAULT_COLUMNS
  ) {
    out.columns = columns as Exclude<GalleryColumns, 3>;
  }
  if (
    typeof raw.aspect === "string" &&
    (GALLERY_ASPECTS as readonly string[]).includes(raw.aspect) &&
    raw.aspect !== GALLERY_DEFAULT_ASPECT
  ) {
    out.aspect = raw.aspect as Exclude<GalleryAspect, "1:1">;
  }
  if (
    typeof raw.gap === "string" &&
    (GALLERY_GAPS as readonly string[]).includes(raw.gap) &&
    raw.gap !== GALLERY_DEFAULT_GAP
  ) {
    out.gap = raw.gap as Exclude<GalleryGap, "md">;
  }
  if (raw.captions === true) out.captions = true;
  if (raw.lightbox === true) out.lightbox = true;
  if (raw.showMotionControls === true) out.showMotionControls = true;
  return out;
}

/** `undefined` = no usable image (an empty gallery is not stored). */
export function normalizeGalleryContent(
  raw: unknown,
  sanitizeHref: (value: string) => string,
): GalleryContent | undefined {
  if (!isRecord(raw)) return undefined;
  const images: GalleryImage[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.images) ? raw.images : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!isRecord(entry)) continue;
    const image = normalizeImage(entry, index, sanitizeHref);
    if (!image || seen.has(image.id)) continue;
    seen.add(image.id);
    images.push(image);
    if (images.length >= MAX_GALLERY_IMAGES) break;
  }
  if (images.length === 0) return undefined;
  const content: GalleryContent = { images };
  const options = normalizeOptions(raw.options);
  if (Object.keys(options).length > 0) content.options = options;
  return content;
}

export interface GalleryPublishIssue {
  /** Path inside the section: `images` (count). */
  path: string;
  code: "gallery_images_min";
}

/**
 * Twin of PHP `GalleryPublishRules::errors` for one visible gallery: at least two images.
 * (No contrast verdict — nothing is drawn over a gallery picture; alt text and media ownership
 * belong to the generic media Publish gate.)
 */
export function galleryPublishIssues(
  content: GalleryContent | undefined,
): GalleryPublishIssue[] {
  return (content?.images.length ?? 0) < MIN_GALLERY_IMAGES_TO_PUBLISH
    ? [{ path: "images", code: "gallery_images_min" }]
    : [];
}
