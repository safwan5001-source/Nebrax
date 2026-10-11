"use client";

import { type CSSProperties, useState } from "react";
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
 */
export interface CanvasSliderLabels {
  label: string;
  slide: string;
  previous: string;
  next: string;
  goTo: string;
  empty: string;
  autoplayNote: string;
}

type Viewport = "desktop" | "tablet" | "mobile";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function position(focal?: { x: number; y: number }) {
  return focal ? `${focal.x}% ${focal.y}%` : "50% 50%";
}

function SlidePicture({ media, mobile, viewport }: { media: MediaRef; mobile: MediaRef | null; viewport: Viewport }) {
  const defaultUrl = useMediaRefPreview(media);
  const phoneUrl = useMediaRefPreview(mobile);
  const usePhone = viewport === "mobile" && !!phoneUrl && !!mobile;
  const src = usePhone ? phoneUrl : defaultUrl;
  if (!src) return null;
  const focal = usePhone ? mobile?.focal : media.focal;
  return (
    <picture data-slider-picture="" style={{ "--sl-pos": position(focal), "--sl-pos-m": position(focal) } as CSSProperties}>
      {/* biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import */}
      <img src={src} alt="" decoding="async" />
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
}: {
  slides: SliderSlide[];
  behaviour: Parameters<typeof resolveSliderBehaviour>[0];
  context: DesignContext;
  viewport: Viewport;
  labels: CanvasSliderLabels;
  /** The slide the editor has selected; the preview shows it. Absent ⇒ the first. */
  activeSlideId?: string | null;
}) {
  const behaviour = resolveSliderBehaviour(rawBehaviour);
  const [browsed, setBrowsed] = useState(0);
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

  const go = (to: number) => setBrowsed(Math.max(0, Math.min(total - 1, to)));
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
                {draw.surface === "picture" ? <SlidePicture media={slide.media} mobile={slide.mobile ?? null} viewport={viewport} /> : null}
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
      {total > 1 ? (
        <>
          {behaviour.arrows ? (
            <>
              <button type="button" data-slider-arrow="previous" aria-label={labels.previous} aria-disabled={!canPrev} onClick={() => go(active > 0 ? active - 1 : canPrev ? total - 1 : active)}>
                <ChevronGlyph />
              </button>
              <button type="button" data-slider-arrow="next" aria-label={labels.next} aria-disabled={!canNext} onClick={() => go(active < total - 1 ? active + 1 : canNext ? 0 : active)}>
                <ChevronGlyph />
              </button>
            </>
          ) : null}
          {behaviour.dots ? (
            <div data-slider-bar="">
              {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form fieldset */}
              <div role="group" aria-label={labels.label} data-slider-dots="">
                {slides.map((slide, index) => (
                  <button key={slide.id} type="button" aria-label={fill(labels.goTo, { number: index + 1 })} aria-current={index === active ? "true" : undefined} onClick={() => go(index)}>
                    <span aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
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
