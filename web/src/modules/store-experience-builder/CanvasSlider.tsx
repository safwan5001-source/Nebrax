"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useAnimatedPreview } from "./media/animated-preview-store";
import { CanvasMotionToggle, type CanvasMotionLabels, usePrefersReducedMotion } from "./media/CanvasMotion";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import type { MediaRef } from "./presentation/media-ref";
import type { DesignContext } from "./presentation/section-design-resolve";
import { resolveSliderBehaviour, type SliderSlide, slideDraw } from "./presentation/slider-content";

/**
 * CUST-HV V8c — the Canvas's twin of the storefront's `HomeSlider`: the SAME `data-slider` DOM and the same decision per slide (`slideDraw`,
 * fed by the editor's read-only proven bounds), so the one CSS block (kept identical in both stylesheets) styles both. It differs only
 * where an editor must: the picture URL is the signed workspace preview (`useMediaRefPreview`), the phone picture is chosen from the
 * simulated `viewport` (not a media query against the host window — `data-vp` carries the device so the preview stylesheet can size the
 * copy for it), arrows / dots browse the slides but nothing autoplays, and an incomplete slider says what it still needs.
 *
 * AWJ-ANIMATED-MEDIA — an animated GIF/WebP slide plays on the active slide as on the published page (same `<picture><img>`, `src`
 * swapped to the signed sanitised animation) with the storefront's pause/play control as the first item of the same `data-slider-bar`
 * pill. The still is the default for reduced motion and while paused. Inactive slides stay on their still (they are inert and hidden).
 */
export interface CanvasSliderLabels {
  label: string;
  slide: string;
  previous: string;
  next: string;
  goTo: string;
  empty: string;
  autoplayNote: string;
  /** The motion control's names — optional so a caller that predates animated media renders as before. */
  motion?: CanvasMotionLabels;
}

type Viewport = "desktop" | "tablet" | "mobile";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function position(focal?: { x: number; y: number }) {
  return focal ? `${focal.x}% ${focal.y}%` : "50% 50%";
}

function SlidePicture({
  slideId,
  media,
  mobile,
  viewport,
  live,
  onMotion,
}: {
  slideId: string;
  media: MediaRef;
  mobile: MediaRef | null;
  viewport: Viewport;
  /** Play the animation (the slide is the active one, motion is on and the editor allows it). */
  live: boolean;
  /** Tells the slider whether this slide has an animated picture (it owns the one shared control). */
  onMotion: (slideId: string, animated: boolean) => void;
}) {
  const defaultUrl = useMediaRefPreview(media);
  const phoneUrl = useMediaRefPreview(mobile);
  const defaultMotion = useAnimatedPreview(media.mediaId);
  const phoneMotion = useAnimatedPreview(mobile?.mediaId);
  const [failed, setFailed] = useState<string | null>(null);
  const animated = !!(defaultMotion || phoneMotion);
  useEffect(() => {
    onMotion(slideId, animated);
    return () => onMotion(slideId, false);
  }, [slideId, animated, onMotion]);
  const usePhone = viewport === "mobile" && !!phoneUrl && !!mobile;
  const motion = usePhone ? phoneMotion : defaultMotion;
  const playing = live && !!motion && failed !== motion;
  const src = playing ? motion : usePhone ? phoneUrl : defaultUrl;
  if (!src) return null;
  const focal = usePhone ? mobile?.focal : media.focal;
  return (
    <picture data-slider-picture="" style={{ "--sl-pos": position(focal), "--sl-pos-m": position(focal) } as CSSProperties}>
      {/* biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import */}
      <img src={src} alt="" decoding="async" onError={playing ? () => setFailed(motion) : undefined} />
    </picture>
  );
}

export function CanvasSlider({
  slides,
  behaviour: rawBehaviour,
  context,
  viewport,
  labels,
  activeSlideId,
  onActiveSlideChange,
}: {
  slides: SliderSlide[];
  behaviour: Parameters<typeof resolveSliderBehaviour>[0];
  context: DesignContext;
  viewport: Viewport;
  labels: CanvasSliderLabels;
  /** The slide the editor has selected; the preview shows it. Absent ⇒ the first. */
  activeSlideId?: string | null;
  /** Browsing in the Canvas selects the slide in the editor panel too. */
  onActiveSlideChange?: (slideId: string) => void;
}) {
  const behaviour = resolveSliderBehaviour(rawBehaviour);
  const [browsed, setBrowsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [motionSlides, setMotionSlides] = useState<ReadonlySet<string>>(() => new Set());
  const reduced = usePrefersReducedMotion();
  const onMotion = useCallback((slideId: string, animated: boolean) => {
    setMotionSlides((prev) => {
      if (prev.has(slideId) === animated) return prev;
      const next = new Set(prev);
      if (animated) next.add(slideId);
      else next.delete(slideId);
      return next;
    });
  }, []);
  const total = slides.length;
  const selected = activeSlideId ? slides.findIndex((slide) => slide.id === activeSlideId) : -1;
  const active = Math.min(selected >= 0 ? selected : browsed, Math.max(0, total - 1));

  if (total === 0) {
    return (
      <section data-slider-empty="" className="rounded-store border border-dashed border-store-border-strong bg-store-surface px-4 py-5">
        <p className="text-xs text-store-muted-foreground">{labels.empty}</p>
      </section>
    );
  }

  const go = (to: number) => {
    const next = Math.max(0, Math.min(total - 1, to));
    setBrowsed(next);
    onActiveSlideChange?.(slides[next].id);
  };
  const showMotion = motionSlides.size > 0 && !reduced && !!labels.motion;
  const canPrev = behaviour.loop || active > 0;
  const canNext = behaviour.loop || active < total - 1;

  return (
    <section
      data-slider=""
      data-vp={viewport}
      data-transition={behaviour.transition}
      data-duration={behaviour.duration}
      dir={context.dir}
      aria-roledescription="carousel"
      aria-label={labels.label}
      style={{ "--sl-active": active } as CSSProperties}
    >
      <div data-slider-viewport="">
        <div data-slider-track="" aria-live="off">
          {slides.map((slide, index) => {
            const draw = slideDraw(slide, context);
            const isActive = index === active;
            const style = {
              "--sl-i": index,
              ...(draw.foreground ? { "--sl-fg": draw.foreground } : {}),
              ...(draw.buttonLabel ? { "--sl-btn": draw.buttonLabel } : {}),
              ...(draw.overlay ? { "--sl-ovl": draw.overlay.colour, "--sl-ovl-a": String(draw.overlay.alpha) } : {}),
            } as CSSProperties;
            const cta = slide.cta && slide.cta.label.trim() !== "" && slide.cta.href.trim() !== "" ? slide.cta : null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: the APG carousel pattern names each slide with role="group" + aria-roledescription="slide"
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={fill(labels.slide, { current: index + 1, total })}
                data-slider-slide=""
                data-active={isActive ? "" : undefined}
                data-surface={draw.surface}
                data-align={slide.align ?? "start"}
                data-slide-id={slide.id}
                aria-hidden={isActive ? undefined : true}
                inert={!isActive}
                style={style}
              >
                {draw.surface === "picture" ? (
                  <SlidePicture
                    slideId={slide.id}
                    media={slide.media}
                    mobile={slide.mobile ?? null}
                    viewport={viewport}
                    live={playing && !reduced && isActive}
                    onMotion={onMotion}
                  />
                ) : null}
                {draw.overlay ? <div data-slider-wash="" /> : null}
                {slide.heading || slide.sub || cta ? (
                  <div data-slider-copy="">
                    {slide.heading ? (
                      <h2>
                        <bdi>{slide.heading}</bdi>
                      </h2>
                    ) : null}
                    {slide.sub ? <p>{slide.sub}</p> : null}
                    {cta ? (
                      <span data-slider-cta="">
                        <span>{cta.label}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {total > 1 && behaviour.arrows ? (
        <>
          <button type="button" data-slider-arrow="previous" aria-label={labels.previous} aria-disabled={!canPrev} onClick={() => go(active > 0 ? active - 1 : canPrev ? total - 1 : active)}>
            <ChevronGlyph />
          </button>
          <button type="button" data-slider-arrow="next" aria-label={labels.next} aria-disabled={!canNext} onClick={() => go(active < total - 1 ? active + 1 : canNext ? 0 : active)}>
            <ChevronGlyph />
          </button>
        </>
      ) : null}
      {(total > 1 && behaviour.dots) || showMotion ? (
        <div data-slider-bar="">
          {showMotion && labels.motion ? <CanvasMotionToggle playing={playing} onToggle={() => setPlaying((p) => !p)} labels={labels.motion} /> : null}
          {total > 1 && behaviour.dots ? (
            // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form fieldset
            <div role="group" aria-label={labels.label} data-slider-dots="">
              {slides.map((slide, index) => (
                <button key={slide.id} type="button" aria-label={fill(labels.goTo, { number: index + 1 })} aria-current={index === active ? "true" : undefined} onClick={() => go(index)}>
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {behaviour.autoplay ? <p data-slider-note="" className="sr-only">{labels.autoplayNote}</p> : null}
    </section>
  );
}

function ChevronGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className="size-5 stroke-current">
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
