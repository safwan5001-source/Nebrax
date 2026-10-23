/**
 * CUST-HV V8f — pure edits of a `gallery` section's content (V0 §13.2). Like `slider-edit.ts`: the editor never builds the stored shape by
 * hand — every change goes through these functions, which keep the invariants the normaliser would otherwise repair silently (≤ 24 images,
 * unique ids, no empty strings, only non-default options), so what the merchant sees is what is stored and what the Publish rule judges.
 */
import {
  GALLERY_DEFAULT_ASPECT,
  GALLERY_DEFAULT_COLUMNS,
  GALLERY_DEFAULT_GAP,
  type GalleryContent,
  type GalleryImage,
  type GalleryOptions,
  MAX_GALLERY_CAPTION_LENGTH,
  MAX_GALLERY_IMAGES,
  type ResolvedGalleryOptions,
  resolveGalleryOptions,
} from "./presentation/gallery-content";
import type { MediaRef } from "./presentation/media-ref";
import { newHomeSectionId } from "./presentation/section-capabilities";

export function canAddImage(content: GalleryContent): boolean {
  return content.images.length < MAX_GALLERY_IMAGES;
}

export function newImageId(): string {
  return newHomeSectionId();
}

/** A new image is only its picture; the caption and link come afterwards (a picture is what makes an image exist). */
export function addImage(content: GalleryContent, media: MediaRef, id: string = newImageId()): GalleryContent {
  if (!canAddImage(content)) return content;
  return { ...content, images: [...content.images, { id, media }] };
}

export function removeImage(content: GalleryContent, id: string): GalleryContent {
  return { ...content, images: content.images.filter((image) => image.id !== id) };
}

/** The copy is inserted right after the original with a fresh id; returns the new id so the editor can select it. */
export function duplicateImage(
  content: GalleryContent,
  id: string,
  newId: string = newImageId(),
): { content: GalleryContent; id: string | null } {
  const index = content.images.findIndex((image) => image.id === id);
  if (index < 0 || !canAddImage(content)) return { content, id: null };
  const copy: GalleryImage = { ...structuredClone(content.images[index]), id: newId };
  const images = [...content.images];
  images.splice(index + 1, 0, copy);
  return { content: { ...content, images }, id: newId };
}

export function moveImage(content: GalleryContent, id: string, delta: -1 | 1): GalleryContent {
  const index = content.images.findIndex((image) => image.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= content.images.length) return content;
  const images = [...content.images];
  const [image] = images.splice(index, 1);
  images.splice(target, 0, image);
  return { ...content, images };
}

function replaceImage(content: GalleryContent, id: string, change: (image: GalleryImage) => GalleryImage): GalleryContent {
  return { ...content, images: content.images.map((image) => (image.id === id ? change(image) : image)) };
}

/** Code-point truncation, as the normalisers do; a blank value removes the field (absence, never an empty string). */
export function setImageCaption(content: GalleryContent, id: string, value: string): GalleryContent {
  const limited = Array.from(value).slice(0, MAX_GALLERY_CAPTION_LENGTH).join("");
  return replaceImage(content, id, (image) => {
    const { caption: _previous, ...rest } = image;
    return limited.trim() === "" ? rest : { ...rest, caption: limited };
  });
}

/** An empty link removes the field; what is kept is judged by the shared content-href sanitiser when the document is normalised. */
export function setImageLink(content: GalleryContent, id: string, href: string): GalleryContent {
  return replaceImage(content, id, (image) => {
    const { link: _previous, ...rest } = image;
    return href.trim() === "" ? rest : { ...rest, link: href };
  });
}

/** The picture of this image: its alt / decorative / framing / `fit` are the merchant's, kept whole. */
export function setImageMedia(content: GalleryContent, id: string, media: MediaRef): GalleryContent {
  return replaceImage(content, id, (image) => ({ ...image, media }));
}

/** Only values that differ from the default are stored. */
export function compactOptions(resolved: ResolvedGalleryOptions): GalleryOptions {
  const out: GalleryOptions = {};
  if (resolved.columns !== GALLERY_DEFAULT_COLUMNS) out.columns = resolved.columns as Exclude<typeof resolved.columns, 3>;
  if (resolved.aspect !== GALLERY_DEFAULT_ASPECT) out.aspect = resolved.aspect as Exclude<typeof resolved.aspect, "1:1">;
  if (resolved.gap !== GALLERY_DEFAULT_GAP) out.gap = resolved.gap as Exclude<typeof resolved.gap, "md">;
  if (resolved.captions) out.captions = true;
  if (resolved.lightbox) out.lightbox = true;
  if (resolved.showMotionControls) out.showMotionControls = true;
  return out;
}

export function setOptions(content: GalleryContent, change: Partial<ResolvedGalleryOptions>): GalleryContent {
  const options = compactOptions({ ...resolveGalleryOptions(content.options), ...change });
  const { options: _previous, ...rest } = content;
  return Object.keys(options).length > 0 ? { ...rest, options } : rest;
}
