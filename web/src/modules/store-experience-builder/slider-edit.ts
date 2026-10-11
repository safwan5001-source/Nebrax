/**
 * CUST-HV V8c-2 — pure edits of a `slider` section's content (V0 §13.1). The editor never builds the stored shape by
 * hand: every change goes through these functions, which keep the invariants the normaliser would otherwise repair
 * silently (≤ 8 slides, unique ids, no empty strings, only non-default behaviour), so what the merchant sees is what is
 * stored and what the Publish gate judges.
 */
import { newHomeSectionId } from "./presentation/section-capabilities";
import type { MediaRef } from "./presentation/media-ref";
import { normalizeBackgroundRef, type Align, type ColorRef, type MediaOverlay } from "./presentation/section-design";
import {
  MAX_SLIDER_SLIDES,
  MAX_SLIDE_CTA_LABEL_LENGTH,
  MAX_SLIDE_HEADING_LENGTH,
  MAX_SLIDE_SUB_LENGTH,
  type ResolvedSliderBehaviour,
  type SliderBehaviour,
  type SliderContent,
  type SliderSlide,
  resolveSliderBehaviour,
  SLIDER_DEFAULT_INTERVAL,
} from "./presentation/slider-content";

export function canAddSlide(content: SliderContent): boolean {
  return content.slides.length < MAX_SLIDER_SLIDES;
}

export function newSlideId(): string {
  return newHomeSectionId();
}

/** A new slide is only its picture — the merchant adds the copy afterwards (a picture is what makes a slide exist). */
export function addSlide(content: SliderContent, media: MediaRef, id: string = newSlideId()): SliderContent {
  if (!canAddSlide(content)) return content;
  const { fit: _fit, ...picture } = media;
  return { ...content, slides: [...content.slides, { id, media: picture }] };
}

export function removeSlide(content: SliderContent, id: string): SliderContent {
  return { ...content, slides: content.slides.filter((slide) => slide.id !== id) };
}

/** The copy is inserted right after the original and gets a fresh id; returns the new id so the editor can select it. */
export function duplicateSlide(
  content: SliderContent,
  id: string,
  newId: string = newSlideId(),
): { content: SliderContent; id: string | null } {
  const index = content.slides.findIndex((slide) => slide.id === id);
  if (index < 0 || !canAddSlide(content)) return { content, id: null };
  const copy: SliderSlide = { ...structuredClone(content.slides[index]), id: newId };
  const slides = [...content.slides];
  slides.splice(index + 1, 0, copy);
  return { content: { ...content, slides }, id: newId };
}

export function moveSlide(content: SliderContent, id: string, delta: -1 | 1): SliderContent {
  const index = content.slides.findIndex((slide) => slide.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= content.slides.length) return content;
  const slides = [...content.slides];
  const [slide] = slides.splice(index, 1);
  slides.splice(target, 0, slide);
  return { ...content, slides };
}

function replaceSlide(content: SliderContent, id: string, change: (slide: SliderSlide) => SliderSlide): SliderContent {
  return { ...content, slides: content.slides.map((slide) => (slide.id === id ? change(slide) : slide)) };
}

type TextKey = "heading" | "sub";
const TEXT_LIMIT: Record<TextKey, number> = { heading: MAX_SLIDE_HEADING_LENGTH, sub: MAX_SLIDE_SUB_LENGTH };

/** Code-point truncation, as the normalisers do; a blank value removes the field (absence, never an empty string). */
export function setSlideText(content: SliderContent, id: string, key: TextKey, value: string): SliderContent {
  const limited = Array.from(value).slice(0, TEXT_LIMIT[key]).join("");
  return replaceSlide(content, id, (slide) => {
    const { [key]: _previous, ...rest } = slide;
    return limited.trim() === "" ? rest : { ...rest, [key]: limited };
  });
}

export function setSlideCta(content: SliderContent, id: string, cta: { label?: string; href?: string }): SliderContent {
  return replaceSlide(content, id, (slide) => {
    const label = Array.from(cta.label ?? slide.cta?.label ?? "")
      .slice(0, MAX_SLIDE_CTA_LABEL_LENGTH)
      .join("");
    const href = cta.href ?? slide.cta?.href ?? "";
    const { cta: _previous, ...rest } = slide;
    return label === "" && href === "" ? rest : { ...rest, cta: { label, href } };
  });
}

/** The default-resolution picture. Alt / decorative / focal / crop are kept; `fit` is not part of a slide (V8a). */
export function setSlideMedia(content: SliderContent, id: string, media: MediaRef): SliderContent {
  const { fit: _fit, ...picture } = media;
  return replaceSlide(content, id, (slide) => ({ ...slide, media: picture }));
}

/** The phone picture is art direction of the same content: stored decorative, with no alt of its own. `null` removes it. */
export function setSlideMobile(content: SliderContent, id: string, media: MediaRef | null): SliderContent {
  return replaceSlide(content, id, (slide) => {
    const { mobile: _previous, ...rest } = slide;
    const mobile = media ? normalizeBackgroundRef(media) : undefined;
    return mobile ? { ...rest, mobile } : rest;
  });
}

export function setSlideOverlay(content: SliderContent, id: string, overlay: MediaOverlay | null): SliderContent {
  return replaceSlide(content, id, (slide) => {
    const { overlay: _previous, ...rest } = slide;
    return overlay ? { ...rest, overlay } : rest;
  });
}

/** `undefined` = automatic (the Publish gate's own best-of white / black over the proven range). */
export function setSlideTextColour(content: SliderContent, id: string, colour: ColorRef | undefined): SliderContent {
  return replaceSlide(content, id, (slide) => {
    const { text: _previous, ...rest } = slide;
    return colour ? { ...rest, text: colour } : rest;
  });
}

export function setSlideAlign(content: SliderContent, id: string, align: Align | undefined): SliderContent {
  return replaceSlide(content, id, (slide) => {
    const { align: _previous, ...rest } = slide;
    return align && align !== "start" ? { ...rest, align } : rest;
  });
}

/** Only values that differ from the default are stored, and `interval` means nothing without `autoplay`. */
export function compactBehaviour(resolved: ResolvedSliderBehaviour): SliderBehaviour {
  const out: SliderBehaviour = {};
  if (resolved.autoplay) {
    out.autoplay = true;
    if (resolved.interval !== SLIDER_DEFAULT_INTERVAL) out.interval = resolved.interval as Exclude<typeof resolved.interval, 6>;
  }
  if (resolved.transition !== "slide") out.transition = resolved.transition as Exclude<typeof resolved.transition, "slide">;
  if (resolved.duration !== "base") out.duration = resolved.duration as Exclude<typeof resolved.duration, "base">;
  if (!resolved.arrows) out.arrows = false;
  if (!resolved.dots) out.dots = false;
  if (resolved.loop) out.loop = true;
  return out;
}

export function setBehaviour(content: SliderContent, change: Partial<ResolvedSliderBehaviour>): SliderContent {
  const behaviour = compactBehaviour({ ...resolveSliderBehaviour(content.behaviour), ...change });
  const { behaviour: _previous, ...rest } = content;
  return Object.keys(behaviour).length > 0 ? { ...rest, behaviour } : rest;
}

/** `{name}` placeholders of a message template. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
