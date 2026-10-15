/**
 * AWJ-VD-H1 / VD-3 — the adapters between the media field's `MediaRef` and a facet identity's `image`.
 *
 * A `MediaRef` belongs to the Customizer: it can carry `crop` and `rotate`, and its framing editor keeps its zoom
 * inside `crop.zoom`. A facet identity forbids `crop` / `rotate` (D-09: the shape is a render-time mask over the
 * library's base thumbnails, nothing is baked) and keeps `zoom` on the image itself. So the two never meet directly:
 *
 * - {@link fromFacetImage} hands the field only what it edits for a facet — the id, the alt text and the decorative
 *   choice. Framing is deliberately left out: a `focal` on the ref would also make the field ask the server to
 *   generate a derivative that a facet never uses.
 * - {@link toFacetImage} takes **only** `mediaId`, `alt` and `decorative` back from the field, whatever else the ref
 *   carries, and re-attaches the framing the appearance controls own. It never emits `crop` or `rotate`.
 *
 * Data only (no React).
 */

import type { FacetVisualImage } from "../presentation/facet-visual";
import type { MediaRef } from "../presentation/media-ref";

/** A facet `image` → what the pick-only field edits (never framing). */
export function fromFacetImage(image: FacetVisualImage | undefined | null): MediaRef | null {
  if (!image) return null;
  const ref: MediaRef = { mediaId: image.mediaId };
  if (image.alt) ref.alt = { ...image.alt };
  if (image.decorative) ref.decorative = true;
  return ref;
}

/**
 * The field's `MediaRef` → a facet `image`.
 *
 * `previous` is the image the identity held before this edit. Its `fit` always survives (it is a style choice for this
 * usage). Its `focal` and `zoom` survive only while the **same** picture is kept: they describe one picture's
 * composition, so a replacement starts centred and unzoomed — the same rule the Customizer's field applies to a swap.
 */
export function toFacetImage(
  ref: MediaRef | null | undefined,
  previous?: FacetVisualImage | null,
): FacetVisualImage | null {
  if (!ref) return null;
  const image: FacetVisualImage = { mediaId: ref.mediaId };
  if (previous?.fit) image.fit = previous.fit;
  if (previous?.mediaId === ref.mediaId) {
    if (previous.focal) image.focal = { ...previous.focal };
    if (previous.zoom !== undefined) image.zoom = previous.zoom;
  }
  if (ref.alt) image.alt = { ...ref.alt };
  if (ref.decorative) image.decorative = true;
  return image;
}
