/**
 * CUST-HV V8a — `slider` section content (V0 §13.1, D-16). Byte-identical in web and
 * storefront, pinned to the PHP authority `StorefrontSliderNormalizer` /
 * `SliderPublishRules` by the shared fixture `tests/Fixtures/presentation/slider.json`.
 *
 *   content = { slides: Slide[≤8 stored, ≥2 to publish], behaviour?: Behaviour }
 *   Slide   = { id, media, mobile?, heading?, sub?, cta?: {label, href}, overlay?, text?, align? }
 *
 * AWJ decisions (what V0 left open — not contract changes):
 *  - A slide's `media` keeps `alt` / `decorative` (it can be a meaningful picture) and drops
 *    `fit`: a letterboxed frame would reveal a surface the picture's luminance evidence does
 *    not cover. `mobile` shares the slide's alt (art direction, not a second content), so it
 *    is stored `decorative` with no `alt` / `fit` and the gate asks for no second alt.
 *  - Only fields outside the allow-list drop, one by one; a slide without a usable picture
 *    reference drops whole.
 *  - Behaviour stores only what differs from the default (autoplay off, interval 6 s, slide
 *    transition, base duration, arrows and dots on, no loop) so equivalent documents match
 *    literally; `interval` means nothing without `autoplay` and drops.
 *  - Text is kept as written (code-point truncated; the editor re-normalises on every
 *    keystroke); whitespace alone is absence.
 *  - The slide button is label + link only and always draws as the solid primary button.
 */

import { autoForeground, parseHex, solidInterval } from "./contrast-engine";
import type { MediaRef } from "./media-ref";
import { normalizeMediaRef } from "./media-ref";
import { resolveRoleHex } from "./palette";
import {
  ALIGNS,
  type Align,
  type ColorRef,
  type MediaOverlay,
  normalizeBackgroundRef,
  normalizeColorRef,
  normalizeMediaOverlay,
} from "./section-design";
import {
  type DesignContext,
  effectiveText,
  type SectionContrastIssue,
  sectionContrastIssues,
} from "./section-design-resolve";

export const MAX_SLIDER_SLIDES = 8;
export const MIN_SLIDER_SLIDES_TO_PUBLISH = 2;
export const MAX_SLIDE_HEADING_LENGTH = 120;
export const MAX_SLIDE_SUB_LENGTH = 200;
export const MAX_SLIDE_CTA_LABEL_LENGTH = 80;
export const SLIDER_INTERVALS = [5, 6, 8, 10] as const;
export const SLIDER_DEFAULT_INTERVAL = 6;
export const SLIDER_TRANSITIONS = ["slide", "fade", "none"] as const;
export const SLIDER_DURATIONS = ["fast", "base", "slow"] as const;

export type SliderInterval = (typeof SLIDER_INTERVALS)[number];
export type SliderTransition = (typeof SLIDER_TRANSITIONS)[number];
export type SliderDuration = (typeof SLIDER_DURATIONS)[number];

export interface SliderSlideCta {
  label: string;
  href: string;
}

export interface SliderSlide {
  id: string;
  media: MediaRef;
  mobile?: MediaRef;
  heading?: string;
  sub?: string;
  cta?: SliderSlideCta;
  overlay?: MediaOverlay;
  text?: ColorRef;
  align?: Align;
}

/** Only values that differ from the default are ever stored. */
export interface SliderBehaviour {
  autoplay?: true;
  interval?: Exclude<SliderInterval, 6>;
  transition?: Exclude<SliderTransition, "slide">;
  duration?: Exclude<SliderDuration, "base">;
  arrows?: false;
  dots?: false;
  loop?: true;
}

export interface SliderContent {
  slides: SliderSlide[];
  behaviour?: SliderBehaviour;
}

/** The behaviour with every default made explicit — what a renderer reads. */
export interface ResolvedSliderBehaviour {
  autoplay: boolean;
  interval: SliderInterval;
  transition: SliderTransition;
  duration: SliderDuration;
  arrows: boolean;
  dots: boolean;
  loop: boolean;
}

export function resolveSliderBehaviour(
  behaviour: SliderBehaviour | undefined,
): ResolvedSliderBehaviour {
  return {
    autoplay: behaviour?.autoplay === true,
    interval: behaviour?.interval ?? SLIDER_DEFAULT_INTERVAL,
    transition: behaviour?.transition ?? "slide",
    duration: behaviour?.duration ?? "base",
    arrows: behaviour?.arrows !== false,
    dots: behaviour?.dots !== false,
    loop: behaviour?.loop === true,
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

function normalizeCta(
  raw: unknown,
  sanitizeHref: (value: string) => string,
): SliderSlideCta | undefined {
  if (!isRecord(raw)) return undefined;
  const label = text(raw.label, MAX_SLIDE_CTA_LABEL_LENGTH);
  const href = sanitizeHref(typeof raw.href === "string" ? raw.href : "");
  if (label === "" && href === "") return undefined;
  return { label, href };
}

function normalizeSlide(
  raw: Record<string, unknown>,
  index: number,
  sanitizeHref: (value: string) => string,
): SliderSlide | null {
  const mediaRef = normalizeMediaRef(raw.media);
  if (!mediaRef) return null;
  const { fit: _fit, ...media } = mediaRef;

  const rawId = typeof raw.id === "string" ? phpTrim(raw.id) : "";
  const id = /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : `slide-${index}`;

  const slide: SliderSlide = { id, media };
  const mobile = normalizeBackgroundRef(raw.mobile);
  if (mobile) slide.mobile = mobile;
  const heading = text(raw.heading, MAX_SLIDE_HEADING_LENGTH);
  if (heading !== "") slide.heading = heading;
  const sub = text(raw.sub, MAX_SLIDE_SUB_LENGTH);
  if (sub !== "") slide.sub = sub;
  const cta = normalizeCta(raw.cta, sanitizeHref);
  if (cta) slide.cta = cta;
  const overlay = normalizeMediaOverlay(raw.overlay);
  if (overlay) slide.overlay = overlay;
  const colour = normalizeColorRef(raw.text);
  if (colour) slide.text = colour;
  if (ALIGNS.includes(raw.align as Align)) slide.align = raw.align as Align;
  return slide;
}

function normalizeBehaviour(raw: unknown): SliderBehaviour {
  if (!isRecord(raw)) return {};
  const out: SliderBehaviour = {};
  if (raw.autoplay === true) {
    out.autoplay = true;
    const interval = raw.interval;
    if (
      typeof interval === "number" &&
      (SLIDER_INTERVALS as readonly number[]).includes(interval) &&
      interval !== SLIDER_DEFAULT_INTERVAL
    ) {
      out.interval = interval as Exclude<SliderInterval, 6>;
    }
  }
  if (raw.transition === "fade" || raw.transition === "none") {
    out.transition = raw.transition;
  }
  if (raw.duration === "fast" || raw.duration === "slow") {
    out.duration = raw.duration;
  }
  if (raw.arrows === false) out.arrows = false;
  if (raw.dots === false) out.dots = false;
  if (raw.loop === true) out.loop = true;
  return out;
}

/** `undefined` = no usable slide (an empty slider is not stored). */
export function normalizeSliderContent(
  raw: unknown,
  sanitizeHref: (value: string) => string,
): SliderContent | undefined {
  if (!isRecord(raw)) return undefined;
  const slides: SliderSlide[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.slides) ? raw.slides : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!isRecord(entry)) continue;
    const slide = normalizeSlide(entry, index, sanitizeHref);
    if (!slide || seen.has(slide.id)) continue;
    seen.add(slide.id);
    slides.push(slide);
    if (slides.length >= MAX_SLIDER_SLIDES) break;
  }
  if (slides.length === 0) return undefined;
  const content: SliderContent = { slides };
  const behaviour = normalizeBehaviour(raw.behaviour);
  if (Object.keys(behaviour).length > 0) content.behaviour = behaviour;
  return content;
}

/** What the visitor reads over the picture: heading, sub, or a complete button. */
export function slideHasText(slide: SliderSlide): boolean {
  const cta = slide.cta;
  return (
    (slide.heading ?? "").trim() !== "" ||
    (slide.sub ?? "").trim() !== "" ||
    (cta !== undefined && cta.label.trim() !== "" && cta.href.trim() !== "")
  );
}

export interface SliderPublishIssue {
  /** Path inside the section: `slides` (count), `slides[j].media` or `slides[j].text`. */
  path: string;
  code: "slider_slides_min" | SectionContrastIssue["code"];
}

/**
 * Twin of PHP `SliderPublishRules::errors` for one visible slider: at least two slides,
 * and every slide that carries text proves its text colour over its own picture range under
 * its own overlay, by the same algorithm a hero background uses.
 */
export function sliderPublishIssues(
  content: SliderContent | undefined,
  ctx: DesignContext,
): SliderPublishIssue[] {
  const slides = content?.slides ?? [];
  if (slides.length < MIN_SLIDER_SLIDES_TO_PUBLISH) {
    return [{ path: "slides", code: "slider_slides_min" }];
  }
  const out = new Map<string, SliderPublishIssue>();
  slides.forEach((slide, j) => {
    for (const issue of slideContrastIssues(slide, ctx)) {
      const path =
        issue.field === "background"
          ? `slides[${j}].media`
          : `slides[${j}].text`;
      out.set(path, { path, code: issue.code });
    }
  });
  return [...out.values()];
}

/**
 * The Publish gate's verdict for ONE slide (a slide without copy is never judged) — the editor shows it per slide, whatever the slide
 * count, while `sliderPublishIssues` adds the count rule on top.
 */
export function slideContrastIssues(
  slide: SliderSlide,
  ctx: DesignContext,
): SectionContrastIssue[] {
  return slideHasText(slide)
    ? sectionContrastIssues(sliderPseudoDesign(slide), ctx)
    : [];
}

function sliderPseudoDesign(slide: SliderSlide) {
  return {
    background: {
      kind: "media" as const,
      media: slide.media,
      ...(slide.mobile ? { mobile: slide.mobile } : {}),
      ...(slide.overlay ? { overlay: slide.overlay } : {}),
    },
    ...(slide.text ? { text: { body: slide.text } } : {}),
  };
}

/**
 * What one slide is drawn with — the single decision the published storefront and the editor Canvas share (V8b / V8c). `ctx.mediaBounds` carries
 * the proven bounds of the slide's pictures (the server's, or the editor's read-only ones); a slide with copy whose pictures are **not** proven
 * withholds its picture and draws the brand surface with its own automatic foreground (text is never placed on a surface the proof did not
 * cover). The button is solid in the copy colour, its label the better of pure white / black over that fill.
 */
export interface SlideDraw {
  surface: "picture" | "brand";
  foreground: string | null;
  buttonLabel: string | null;
  overlay: { colour: string; alpha: number } | null;
}

export function slideDraw(slide: SliderSlide, ctx: DesignContext): SlideDraw {
  const design = sliderPseudoDesign(slide);
  const text = effectiveText(design, ctx);
  const proven =
    text.background !== null && sectionContrastIssues(design, ctx).length === 0;
  const hasText = slideHasText(slide);
  const withheld = hasText && !proven;
  const foreground = !hasText
    ? null
    : withheld
      ? effectiveText(
          { background: { kind: "solid", color: { role: "brand" } } },
          ctx,
        ).body
      : text.body;
  const fill = foreground ? parseHex(foreground) : null;
  return {
    surface: withheld ? "brand" : "picture",
    foreground,
    buttonLabel: fill ? autoForeground(solidInterval(fill)) : null,
    overlay:
      !withheld && slide.overlay
        ? {
            colour:
              "role" in slide.overlay.color
                ? resolveRoleHex(slide.overlay.color.role, ctx)
                : slide.overlay.color.hex,
            alpha: slide.overlay.alpha / 100,
          }
        : null,
  };
}
