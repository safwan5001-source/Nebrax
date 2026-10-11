/**
 * CUST-HV V8b — what the published storefront draws for a `slider` section (V0 §13.1).
 *
 * The server publishes, per slide picture, what the browser may load (`presentation_media`, keyed by the
 * reference's JSON path) and the contrast bounds it proved at Publish. This module joins them back to the slide
 * and decides — with the Publish gate's own algorithm (`effectiveText` / `sectionContrastIssues` over the same
 * pseudo-design) — the colour the slide's copy is drawn in:
 *
 *  - a slide with no copy is just a picture (and its optional wash);
 *  - a slide with copy whose picture is **proven** (every picture that can show has valid bounds, and the text
 *    passes over the whole range under the slide's own overlay) draws the picture, the overlay and the proven
 *    colour;
 *  - a slide with copy that is **not** proven (stale or hand-built document, evidence gone) withholds the picture
 *    and draws the brand surface with its own automatic foreground — text is never placed on a surface the proof
 *    did not cover. The Publish gate prevents this state; this is the defensive twin.
 *
 * A slide whose picture the server did not resolve is omitted, never guessed. Slide numbering counts what is drawn.
 */
import type { PresentationHomeSection } from "./config";
import type { MediaRef, ResolvedMedia, ResolvedMediaMap } from "./media-ref";
import { sliderContentOf } from "./section-content";
import type { Align } from "./section-design";
import type { DesignContext, MediaBounds } from "./section-design-resolve";
import {
  type ResolvedSliderBehaviour,
  resolveSliderBehaviour,
  slideDraw,
} from "./slider-content";

export function slidePicturePath(
  sectionIndex: number,
  slideIndex: number,
  key: "media" | "mobile",
): string {
  return `homepage.sections.${sectionIndex}.content.slides.${slideIndex}.${key}`;
}

export interface SlideView {
  id: string;
  /** 1-based, among the slides actually drawn. */
  position: number;
  /** The picture; `null` when it is withheld because the copy over it is unproven. */
  media: ResolvedMedia | null;
  focal?: { x: number; y: number };
  mobile: ResolvedMedia | null;
  mobileFocal?: { x: number; y: number };
  /** Alt text for the visitor's locale; `""` for a decorative picture. */
  alt: string;
  heading: string;
  sub: string;
  cta: { label: string; href: string } | null;
  /** The colour the copy is drawn in (hex), or `null` when the slide has no copy. */
  foreground: string | null;
  /**
   * The slide button is solid in the copy's own colour, so it contrasts with the picture exactly as far as the copy
   * does; its label takes the better of pure white / black over that fill (always ≥ 4.5 : 1).
   */
  buttonLabel: string | null;
  overlay: { colour: string; alpha: number } | null;
  align: Align;
  /** `picture` = the slide's own picture; `brand` = the withheld-picture fallback surface. */
  surface: "picture" | "brand";
}

export interface SliderView {
  slides: SlideView[];
  behaviour: ResolvedSliderBehaviour;
}

function boundsOf(media: ResolvedMedia | undefined): MediaBounds | null {
  return media?.contrast
    ? { min: media.contrast.min, max: media.contrast.max }
    : null;
}

function altFor(media: ResolvedMedia, locale: string): string {
  if (media.decorative) return "";
  return media.alt[locale === "ar" ? "ar" : "en"] ?? "";
}

export function resolveSlider(
  section: PresentationHomeSection,
  sectionIndex: number,
  resolved: ResolvedMediaMap,
  ctx: DesignContext,
  locale: string,
): SliderView | null {
  const content = sliderContentOf(section);
  const slides: SlideView[] = [];

  content.slides.forEach((slide, slideIndex) => {
    const media = resolved[slidePicturePath(sectionIndex, slideIndex, "media")];
    if (!media) return;
    const mobile = slide.mobile
      ? resolved[slidePicturePath(sectionIndex, slideIndex, "mobile")]
      : undefined;

    const cta =
      slide.cta && slide.cta.label.trim() !== "" && slide.cta.href.trim() !== ""
        ? { label: slide.cta.label, href: slide.cta.href }
        : null;

    // Bounds by reference *identity*: two slides may use one picture with different crops.
    const byRef = new Map<MediaRef, MediaBounds>();
    const own = boundsOf(media);
    if (own) byRef.set(slide.media, own);
    const phone = slide.mobile ? boundsOf(mobile) : null;
    if (slide.mobile && phone) byRef.set(slide.mobile, phone);
    // The one decision the editor Canvas shares (`slideDraw`).
    const draw = slideDraw(slide, {
      ...ctx,
      mediaBounds: (ref) => byRef.get(ref) ?? null,
    });
    const withheld = draw.surface === "brand";

    slides.push({
      id: slide.id,
      position: slides.length + 1,
      media: withheld ? null : media,
      ...(!withheld && slide.media.focal ? { focal: slide.media.focal } : {}),
      mobile: withheld ? null : (mobile ?? null),
      ...(!withheld && mobile && slide.mobile?.focal
        ? { mobileFocal: slide.mobile.focal }
        : {}),
      alt: altFor(media, locale),
      heading: slide.heading ?? "",
      sub: slide.sub ?? "",
      cta,
      foreground: draw.foreground,
      buttonLabel: draw.buttonLabel,
      overlay: draw.overlay,
      align: slide.align ?? "start",
      surface: draw.surface,
    });
  });

  if (slides.length === 0) return null;
  return { slides, behaviour: resolveSliderBehaviour(content.behaviour) };
}
