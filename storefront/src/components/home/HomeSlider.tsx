"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { destination } from "@/lib/home/destination";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import type { SliderView, SlideView } from "@/lib/presentation/slider-resolve";

/**
 * CUST-HV V8b (V0 §13.1, D-16, §6.6) — the published slider.
 *
 * One in-house track instead of a carousel library: every requirement of the contract is a handful of
 * rules here (stacked slides, a CSS transition, a timer), and each of them is easier to prove in a real
 * browser — logical RTL, `inert` on inactive slides, reduced motion — when nothing sits between the
 * document and the DOM. No dependency is added to the homepage's critical path.
 *
 *  - **Progressive.** The server renders slide 1 active and every other slide inactive (`inert`, so out of
 *    the tab order and the accessibility tree). The controls — arrows, dots, pause — render only after
 *    hydration: a visitor without JavaScript sees one complete slide, never a dead control.
 *  - **Motion** (`slide | fade | none`) is a CSS transition on `transform` / `opacity` whose duration is a
 *    token (`fast | base | slow`); under `prefers-reduced-motion` the transition is `none` and autoplay does
 *    not start (both in CSS and here).
 *  - **Autoplay** is opt-in and ≥ 5 s. It pauses on hover, on focus within, on the first touch (sticky: the
 *    visitor presses Play to resume), while the tab is hidden, and by the visible Pause / Play button. The
 *    track is `aria-live="off"` while it runs and `polite` once it does not.
 *  - **Input.** Arrows, dots, a swipe (touch / pen) and the keyboard (← → follow the *visual* direction under
 *    RTL, Home / End) always work; a swipe never hijacks vertical scrolling (`touch-action: pan-y`).
 *  - The first slide's picture may load eagerly (`priority`); every other one is lazy, all with dimensions.
 */
export interface SliderLabels {
  /** The carousel's accessible name. */
  label: string;
  /** Per-slide name template: `{current}` / `{total}`. */
  slide: string;
  previous: string;
  next: string;
  /** Dot name template: `{number}`. */
  goTo: string;
  pause: string;
  play: string;
  /** The dots group's name. */
  choose: string;
}

interface HomeSliderProps {
  view: SliderView;
  labels: SliderLabels;
  basePath: string;
  dir: "ltr" | "rtl";
  /** Load the first slide's picture eagerly with a high fetch priority (the slider opens the page). */
  priority?: boolean;
  /** Section id, used to make element ids unique per instance. */
  sectionId: string;
}

const PHONE = "(max-width: 767px)";
const SWIPE_MIN_PX = 40;

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? `{${key}}`),
  );
}

function srcSet(media: ResolvedMedia, format: "webp" | "jpg"): string {
  return media.sources
    .filter((s) => s.kind === "w" && s.format === format)
    .map((s) => `${s.src} ${s.width}w`)
    .join(", ");
}

function SlidePicture({ slide, eager }: { slide: SlideView; eager: boolean }) {
  const media = slide.media;
  if (!media) return null;
  const widths = media.sources.filter((s) => s.kind === "w");
  const fallback =
    widths.filter((s) => s.format === "jpg").at(-1) ??
    widths.at(-1) ??
    media.sources[0];
  const position = (focal?: { x: number; y: number }) =>
    focal ? `${focal.x}% ${focal.y}%` : "50% 50%";
  const style = {
    "--sl-pos": position(slide.focal),
    ...(slide.mobile ? { "--sl-pos-m": position(slide.mobileFocal) } : {}),
  } as CSSProperties;
  const mobileWebp = slide.mobile ? srcSet(slide.mobile, "webp") : "";
  const mobileJpg = slide.mobile ? srcSet(slide.mobile, "jpg") : "";
  const webp = srcSet(media, "webp");

  return (
    <picture data-slider-picture="" style={style}>
      {mobileWebp ? (
        <source
          media={PHONE}
          type="image/webp"
          srcSet={mobileWebp}
          sizes="100vw"
        />
      ) : null}
      {mobileJpg ? (
        <source
          media={PHONE}
          type="image/jpeg"
          srcSet={mobileJpg}
          sizes="100vw"
        />
      ) : null}
      {webp ? <source type="image/webp" srcSet={webp} sizes="100vw" /> : null}
      <img
        src={fallback.src}
        srcSet={srcSet(media, "jpg") || undefined}
        sizes="100vw"
        width={media.width}
        height={media.height}
        alt={slide.alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
      />
    </picture>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      className="size-5 stroke-current"
    >
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeSlider({
  view,
  labels,
  basePath,
  dir,
  priority = false,
  sectionId,
}: HomeSliderProps) {
  const { slides, behaviour } = view;
  const total = slides.length;
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const sync = () => setReduced(query?.matches === true);
    sync();
    query?.addEventListener("change", sync);
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      query?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const loop = behaviour.loop;
  const atStart = active === 0;
  const atEnd = active === total - 1;
  const canPrev = loop || !atStart;
  const canNext = loop || !atEnd;

  const next = useCallback(() => {
    setActive((a) => (a + 1 < total ? a + 1 : loop ? 0 : a));
  }, [total, loop]);
  const previous = useCallback(() => {
    setActive((a) => (a > 0 ? a - 1 : loop ? total - 1 : a));
  }, [total, loop]);

  const autoplay = behaviour.autoplay && !reduced && total > 1;
  const running = autoplay && !paused && !hovering && !focused && !tabHidden;
  const { interval } = behaviour;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (!loop && active === total - 1) {
        // Without looping the show ends on the last slide: stay put and offer Play.
        setPaused(true);
        return;
      }
      next();
    }, interval * 1000);
    // Re-armed on every slide change, so a manual move restarts the interval.
    return () => window.clearTimeout(timer);
  }, [running, active, interval, loop, total, next]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (total < 2) return;
    // Arrows follow the visual direction: under RTL the right arrow goes back.
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward) next();
    else if (event.key === backward) previous();
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(total - 1);
    else return;
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    // The first touch pauses autoplay for good (the visitor presses Play to resume).
    if (autoplay) setPaused(true);
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId || total < 2) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.2) {
      return;
    }
    // Dragging toward the inline-start edge reveals the next slide.
    const towardStart = dir === "rtl" ? dx > 0 : dx < 0;
    if (towardStart) next();
    else previous();
  };

  const controls = mounted && total > 1;
  const idBase = `slider-${sectionId}`;

  return (
    <section
      ref={rootRef}
      data-slider=""
      data-transition={behaviour.transition}
      data-duration={behaviour.duration}
      data-motion={reduced ? "reduced" : undefined}
      dir={dir}
      aria-roledescription="carousel"
      aria-label={labels.label}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      style={{ "--sl-active": active } as CSSProperties}
    >
      <div
        data-slider-viewport=""
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <div
          id={`${idBase}-track`}
          data-slider-track=""
          aria-live={running ? "off" : "polite"}
        >
          {slides.map((slide, index) => {
            const isActive = index === active;
            const href = slide.cta
              ? destination(basePath, slide.cta.href)
              : null;
            const style = {
              "--sl-i": index,
              ...(slide.foreground ? { "--sl-fg": slide.foreground } : {}),
              ...(slide.buttonLabel ? { "--sl-btn": slide.buttonLabel } : {}),
              ...(slide.overlay
                ? {
                    "--sl-ovl": slide.overlay.colour,
                    "--sl-ovl-a": String(slide.overlay.alpha),
                  }
                : {}),
            } as CSSProperties;
            return (
              // biome-ignore lint/a11y/useSemanticElements: the APG carousel pattern names each slide with role="group" + aria-roledescription="slide"
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={fill(labels.slide, {
                  current: slide.position,
                  total,
                })}
                data-slider-slide=""
                data-active={isActive ? "" : undefined}
                data-surface={slide.surface}
                data-align={slide.align}
                aria-hidden={isActive ? undefined : true}
                inert={!isActive}
                style={style}
              >
                <SlidePicture slide={slide} eager={priority && index === 0} />
                {slide.overlay ? <div data-slider-wash="" /> : null}
                {slide.heading || slide.sub || (slide.cta && href) ? (
                  <div data-slider-copy="">
                    {slide.heading ? (
                      <h2>
                        <bdi>{slide.heading}</bdi>
                      </h2>
                    ) : null}
                    {slide.sub ? <p>{slide.sub}</p> : null}
                    {slide.cta && href ? (
                      <Link href={href} data-slider-cta="">
                        <span>{slide.cta.label}</span>
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {controls ? (
        <>
          {behaviour.arrows ? (
            <>
              <button
                type="button"
                data-slider-arrow="previous"
                aria-label={labels.previous}
                aria-controls={`${idBase}-track`}
                aria-disabled={!canPrev}
                onClick={previous}
              >
                <Chevron />
              </button>
              <button
                type="button"
                data-slider-arrow="next"
                aria-label={labels.next}
                aria-controls={`${idBase}-track`}
                aria-disabled={!canNext}
                onClick={next}
              >
                <Chevron />
              </button>
            </>
          ) : null}
          <div data-slider-bar="">
            {autoplay ? (
              <button
                type="button"
                data-slider-pause=""
                aria-label={paused ? labels.play : labels.pause}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                  </svg>
                )}
              </button>
            ) : null}
            {behaviour.dots ? (
              // biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form fieldset
              <div role="group" aria-label={labels.choose} data-slider-dots="">
                {slides.map((slide, index) => (
                  <button
                    key={slide.id}
                    type="button"
                    aria-label={fill(labels.goTo, { number: slide.position })}
                    aria-current={index === active ? "true" : undefined}
                    aria-controls={`${idBase}-track`}
                    onClick={() => setActive(index)}
                  >
                    <span aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
