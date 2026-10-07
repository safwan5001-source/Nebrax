/**
 * CUST-HV V6b-3 — a section's picture background on the published storefront.
 *
 * The server publishes, per `MediaRef`, what the browser may load (`presentation_media`, keyed by the
 * reference's JSON path) and — for pictures under `design.background` only — the contrast bounds it
 * proved at publish time. This module joins them back to the section:
 *  - `mediaBoundsLookup` hands the design resolver the bounds of each picture (so the automatic text
 *    colour is decided by the same algorithm as the publish gate; no bounds ⇒ unproven ⇒ the
 *    resolver paints no picture and the section keeps its legacy surface and text colours);
 *  - `sectionBackdrop` returns what the section renders as its backdrop layer.
 * The path is built from the section's index in the *whole* section list (hidden ones included),
 * exactly as the server keys it.
 */
import type { PresentationHomeSection } from "./config";
import type { MediaRef, ResolvedMedia, ResolvedMediaMap } from "./media-ref";
import type { MediaBounds } from "./section-design-resolve";

export function backgroundMediaPath(
  index: number,
  key: "media" | "mobile",
): string {
  return `homepage.sections.${index}.design.background.${key}`;
}

/**
 * Bounds by reference *identity*: the resolver is handed `section.design.background.media/mobile`
 * (the very objects of the published document), so each lookup is unambiguous even when two
 * sections use the same picture with different crops.
 */
export function mediaBoundsLookup(
  sections: readonly PresentationHomeSection[],
  resolved: ResolvedMediaMap,
): (ref: MediaRef) => MediaBounds | null {
  const byRef = new Map<MediaRef, MediaBounds>();
  sections.forEach((section, index) => {
    const bg = section.design?.background;
    if (bg?.kind !== "media") return;
    for (const key of ["media", "mobile"] as const) {
      const ref = bg[key];
      const contrast = ref
        ? resolved[backgroundMediaPath(index, key)]?.contrast
        : undefined;
      if (ref && contrast)
        byRef.set(ref, { min: contrast.min, max: contrast.max });
    }
  });
  return (ref) => byRef.get(ref) ?? null;
}

export interface SectionBackdropData {
  media: ResolvedMedia;
  focal?: { x: number; y: number };
  mobile?: ResolvedMedia;
  overlay: boolean;
}

/** `null` when the section has no picture background or the server resolved no picture for it. */
export function sectionBackdrop(
  section: PresentationHomeSection,
  index: number,
  resolved: ResolvedMediaMap,
): SectionBackdropData | null {
  const bg = section.design?.background;
  if (bg?.kind !== "media") return null;
  const media = resolved[backgroundMediaPath(index, "media")];
  if (!media) return null;
  const mobile = bg.mobile
    ? resolved[backgroundMediaPath(index, "mobile")]
    : undefined;
  return {
    media,
    ...(bg.media.focal ? { focal: bg.media.focal } : {}),
    ...(mobile ? { mobile } : {}),
    overlay: bg.overlay !== undefined,
  };
}
