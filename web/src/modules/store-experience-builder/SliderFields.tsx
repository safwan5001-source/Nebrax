"use client";

/**
 * CUST-HV V8c-2 — the `slider` section's editor (V0 §13.1): the slides (add, duplicate, reorder, delete), the selected
 * slide's picture / phone picture / copy / button / wash / text colour / alignment, and the slider's behaviour.
 *
 * Everything goes through the pure edits in `slider-edit.ts`; the contrast verdict per slide is the Publish gate's own
 * (`slideContrastIssues`, fed by the proven bounds the Canvas also reads), so what this panel says is what Publish will say.
 * The selected slide is the one the Canvas shows (`activeSlideId`), and browsing in the Canvas selects here.
 */
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeferredCommitField, Field, inputClass, Segmented, selectClass, Toggle } from "./ControlPanels";
import { ColourField } from "./design/ColourField";
import { MediaPicker } from "./media/MediaPicker";
import { MediaRefField } from "./media/MediaRefField";
import type { BackgroundMediaBounds } from "./media/use-background-media-bounds";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import type { CustomizerMessageKey } from "./messages";
import { ALIGNS, OVERLAY_ALPHAS, type MediaOverlay } from "./presentation/section-design";
import type { DesignContext } from "./presentation/section-design-resolve";
import {
  MAX_SLIDE_HEADING_LENGTH,
  MAX_SLIDE_SUB_LENGTH,
  MAX_SLIDER_SLIDES,
  MIN_SLIDER_SLIDES_TO_PUBLISH,
  SLIDER_DURATIONS,
  SLIDER_INTERVALS,
  SLIDER_TRANSITIONS,
  type SliderContent,
  type SliderSlide,
  resolveSliderBehaviour,
  slideContrastIssues,
  slideHasText,
} from "./presentation/slider-content";
import {
  addSlide,
  canAddSlide,
  duplicateSlide,
  fillTemplate,
  moveSlide,
  removeSlide,
  setBehaviour,
  setSlideAlign,
  setSlideCta,
  setSlideMedia,
  setSlideMobile,
  setSlideOverlay,
  setSlideText,
  setSlideTextColour,
} from "./slider-edit";

type T = (key: CustomizerMessageKey) => string;

const ALIGN_LABEL = {
  start: "designAlignStart",
  center: "designAlignCenter",
  end: "designAlignEnd",
} as const satisfies Record<(typeof ALIGNS)[number], CustomizerMessageKey>;

const TRANSITION_LABEL = {
  slide: "sliderTransitionSlide",
  fade: "sliderTransitionFade",
  none: "sliderTransitionNone",
} as const satisfies Record<(typeof SLIDER_TRANSITIONS)[number], CustomizerMessageKey>;

const DURATION_LABEL = {
  fast: "sliderDurationFast",
  base: "sliderDurationBase",
  slow: "sliderDurationSlow",
} as const satisfies Record<(typeof SLIDER_DURATIONS)[number], CustomizerMessageKey>;

type PictureStatus = "none" | "checking" | "noEvidence" | "unprovable" | "textIssue" | "ok";

/** What the merchant is told about a slide's legibility — derived from the Publish gate's own verdict. */
function pictureStatusOf(slide: SliderSlide, ctx: DesignContext, bounds: BackgroundMediaBounds): PictureStatus {
  if (!slideHasText(slide)) return "none";
  const states = [slide.media, slide.mobile].filter((ref) => !!ref).map((ref) => bounds.stateOf(ref!));
  if (states.includes("loading")) return "checking";
  if (states.includes("unavailable")) return "noEvidence";
  const issues = slideContrastIssues(slide, ctx);
  if (issues.some((issue) => issue.field === "background")) return "unprovable";
  return issues.length > 0 ? "textIssue" : "ok";
}

const iconButton =
  "inline-flex size-11 items-center justify-center text-muted hover:bg-background hover:text-text disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:size-8";

export function SliderFields({
  content,
  ctx,
  bounds,
  locale,
  t,
  activeSlideId,
  onActiveSlideChange,
  onChange,
}: {
  content: SliderContent;
  ctx: DesignContext;
  bounds: BackgroundMediaBounds;
  locale: "ar" | "en";
  t: T;
  /** The slide the Canvas shows; absent / unknown ⇒ the first. */
  activeSlideId: string | null;
  onActiveSlideChange: (id: string) => void;
  onChange: (content: SliderContent) => void;
}) {
  const [picking, setPicking] = useState(false);
  const slides = content.slides;
  const selectedIndex = Math.max(
    0,
    slides.findIndex((slide) => slide.id === activeSlideId),
  );
  const selected = slides[selectedIndex] ?? null;
  const behaviour = resolveSliderBehaviour(content.behaviour);

  const remove = (index: number) => {
    const target = slides[index];
    onChange(removeSlide(content, target.id));
    const neighbour = slides[index + 1] ?? slides[index - 1];
    if (neighbour) onActiveSlideChange(neighbour.id);
  };
  const duplicate = (index: number) => {
    const result = duplicateSlide(content, slides[index].id);
    if (!result.id) return;
    onChange(result.content);
    onActiveSlideChange(result.id);
  };

  return (
    <div className="space-y-4" data-slider-fields="">
      <section className="space-y-2" aria-labelledby="slider-slides-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="slider-slides-title" className="text-[12px] font-semibold tracking-wide text-muted">
            {t("sliderSlidesTitle")}
          </h3>
          <span className="text-[12px] tabular-nums text-muted" data-slider-count="">
            {fillTemplate(t("sliderSlidesCount"), { count: slides.length, max: MAX_SLIDER_SLIDES })}
          </span>
        </div>
        {slides.length < MIN_SLIDER_SLIDES_TO_PUBLISH ? (
          <p role="status" data-slider-min="" className="text-[12px] leading-5 text-muted">
            {t("sliderMinHint")}
          </p>
        ) : null}
        <ol className="space-y-1.5" data-slider-slide-list="">
          {slides.map((slide, index) => (
            <SlideRow
              key={slide.id}
              slide={slide}
              index={index}
              total={slides.length}
              selected={index === selectedIndex}
              status={pictureStatusOf(slide, ctx, bounds)}
              canDuplicate={canAddSlide(content)}
              t={t}
              onSelect={() => onActiveSlideChange(slide.id)}
              onMove={(delta) => onChange(moveSlide(content, slide.id, delta))}
              onDuplicate={() => duplicate(index)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
        <button
          type="button"
          data-slider-add=""
          disabled={!canAddSlide(content)}
          onClick={() => setPicking(true)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 border border-dashed border-border bg-surface px-3 text-[13px] font-medium text-text hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("sliderAdd")}
        </button>
        {!canAddSlide(content) ? (
          <p className="text-[12px] leading-5 text-muted">
            {fillTemplate(t("sliderAddMax"), { max: MAX_SLIDER_SLIDES })}
          </p>
        ) : null}
        <MediaPicker
          open={picking}
          onClose={() => setPicking(false)}
          onSelect={(asset) => {
            setPicking(false);
            const next = addSlide(content, { mediaId: asset.id });
            if (next === content) return;
            onChange(next);
            onActiveSlideChange(next.slides[next.slides.length - 1].id);
          }}
          t={t}
          locale={locale}
        />
      </section>

      {selected ? (
        <SlideEditor
          key={selected.id}
          slide={selected}
          position={selectedIndex + 1}
          ctx={ctx}
          bounds={bounds}
          locale={locale}
          t={t}
          onChange={(edit) => onChange(edit(content))}
        />
      ) : null}

      <fieldset className="min-w-0 space-y-3" data-slider-behaviour="">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">
          {t("sliderBehaviourTitle")}
        </legend>
        <Toggle
          label={t("sliderAutoplay")}
          checked={behaviour.autoplay}
          onChange={(autoplay) => onChange(setBehaviour(content, { autoplay }))}
        />
        {behaviour.autoplay ? (
          <Field label={t("sliderInterval")}>
            <Segmented
              value={String(behaviour.interval)}
              onChange={(id) => onChange(setBehaviour(content, { interval: Number(id) as typeof behaviour.interval }))}
              options={SLIDER_INTERVALS.map((seconds) => ({
                id: String(seconds),
                label: fillTemplate(t("sliderIntervalSeconds"), { seconds }),
              }))}
            />
          </Field>
        ) : null}
        <Field label={t("sliderTransition")}>
          <Segmented
            value={behaviour.transition}
            onChange={(transition) => onChange(setBehaviour(content, { transition }))}
            options={SLIDER_TRANSITIONS.map((id) => ({ id, label: t(TRANSITION_LABEL[id]) }))}
          />
        </Field>
        {behaviour.transition !== "none" ? (
          <Field label={t("sliderDuration")}>
            <Segmented
              value={behaviour.duration}
              onChange={(duration) => onChange(setBehaviour(content, { duration }))}
              options={SLIDER_DURATIONS.map((id) => ({ id, label: t(DURATION_LABEL[id]) }))}
            />
          </Field>
        ) : null}
        <Toggle label={t("sliderArrows")} checked={behaviour.arrows} onChange={(arrows) => onChange(setBehaviour(content, { arrows }))} />
        <Toggle label={t("sliderDots")} checked={behaviour.dots} onChange={(dots) => onChange(setBehaviour(content, { dots }))} />
        <Toggle label={t("sliderLoop")} checked={behaviour.loop} onChange={(loop) => onChange(setBehaviour(content, { loop }))} />
        <p className="text-[12px] leading-5 text-muted">{t("sliderMotionHint")}</p>
      </fieldset>
    </div>
  );
}

function SlideRow({
  slide,
  index,
  total,
  selected,
  status,
  canDuplicate,
  t,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: {
  slide: SliderSlide;
  index: number;
  total: number;
  selected: boolean;
  status: PictureStatus;
  canDuplicate: boolean;
  t: T;
  onSelect: () => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const thumb = useMediaRefPreview(slide.media);
  const number = index + 1;
  const flagged = status === "unprovable" || status === "textIssue" || status === "noEvidence";
  return (
    <li
      data-slider-slide-row={slide.id}
      data-selected={selected ? "" : undefined}
      data-status={status}
      className={`flex items-center gap-1 border ${selected ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-10"
      >
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden border border-border bg-background">
          {thumb ? (
            // biome-ignore lint/performance/noImgElement: editor-only signed preview URL
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-text">{fillTemplate(t("sliderSlideLabel"), { number })}</span>
          <span className="block truncate text-[12px] text-muted" dir="auto">
            {slide.heading || slide.sub || t("sliderSlideNoText")}
          </span>
        </span>
        {flagged ? (
          <span aria-hidden="true" data-slider-flag="" className="size-2 shrink-0 rounded-full bg-negative" />
        ) : null}
      </button>
      <button
        type="button"
        className={iconButton}
        disabled={index === 0}
        aria-label={fillTemplate(t("sliderMoveUp"), { number })}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        className={iconButton}
        disabled={index === total - 1}
        aria-label={fillTemplate(t("sliderMoveDown"), { number })}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        className={iconButton}
        disabled={!canDuplicate}
        aria-label={fillTemplate(t("sliderDuplicate"), { number })}
        onClick={onDuplicate}
      >
        <Copy aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} aria-label={fillTemplate(t("sliderRemove"), { number })} onClick={onRemove}>
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

function SlideEditor({
  slide,
  position,
  ctx,
  bounds,
  locale,
  t,
  onChange,
}: {
  slide: SliderSlide;
  position: number;
  ctx: DesignContext;
  bounds: BackgroundMediaBounds;
  locale: "ar" | "en";
  t: T;
  onChange: (edit: (content: SliderContent) => SliderContent) => void;
}) {
  const id = slide.id;
  const status = pictureStatusOf(slide, ctx, bounds);
  const overlay = slide.overlay;
  const setOverlay = (next: MediaOverlay | null) => onChange((content) => setSlideOverlay(content, id, next));
  const textIssue = slideContrastIssues(slide, ctx).find((issue) => issue.field !== "background");

  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      data-slider-slide-editor={id}
      aria-label={fillTemplate(t("sliderSlideLabel"), { number: position })}
    >
      <h3 className="text-[13px] font-semibold text-text">{fillTemplate(t("sliderSlideLabel"), { number: position })}</h3>

      <MediaRefField
        slot="slider-slide"
        label={t("sliderPicture")}
        value={slide.media}
        // a slide always needs its picture: removing it is "delete the slide", which the list offers
        onChange={(media) => media && onChange((content) => setSlideMedia(content, id, media))}
        t={t}
        locale={locale}
        coverOnly
      />
      <MediaRefField
        slot="slider-slide-phone"
        label={t("sliderPicturePhone")}
        hint={t("sliderPicturePhoneHint")}
        value={slide.mobile ?? null}
        onChange={(media) => onChange((content) => setSlideMobile(content, id, media))}
        t={t}
        locale={locale}
        decorativeOnly
      />

      <Field label={t("sliderHeading")} hint={`${Array.from(slide.heading ?? "").length}/${MAX_SLIDE_HEADING_LENGTH}`}>
        <input
          className={inputClass}
          data-slider-heading=""
          value={slide.heading ?? ""}
          onChange={(event) => onChange((content) => setSlideText(content, id, "heading", event.target.value))}
        />
      </Field>
      <Field label={t("sliderSub")} hint={`${Array.from(slide.sub ?? "").length}/${MAX_SLIDE_SUB_LENGTH}`}>
        <textarea
          className={`${inputClass} h-20 py-2`}
          data-slider-sub=""
          value={slide.sub ?? ""}
          onChange={(event) => onChange((content) => setSlideText(content, id, "sub", event.target.value))}
        />
      </Field>

      <fieldset className="min-w-0 space-y-2" data-slider-cta="">
        <Field label={t("sliderCtaLabel")}>
          <input
            className={inputClass}
            value={slide.cta?.label ?? ""}
            onChange={(event) => onChange((content) => setSlideCta(content, id, { label: event.target.value }))}
          />
        </Field>
        <DeferredCommitField
          label={t("sliderCtaHref")}
          value={slide.cta?.href ?? ""}
          dir="ltr"
          onCommit={(href) => onChange((content) => setSlideCta(content, id, { href }))}
        />
        <p className="text-[12px] leading-5 text-muted">{t("sliderCtaHint")}</p>
      </fieldset>

      <Field label={t("designOverlayStrength")}>
        <select
          className={selectClass}
          data-slider-overlay-alpha=""
          value={overlay?.alpha ?? 0}
          onChange={(event) => {
            const alpha = Number(event.target.value);
            setOverlay(alpha === 0 ? null : { color: overlay?.color ?? { role: "overlay" }, alpha: alpha as MediaOverlay["alpha"] });
          }}
        >
          <option value={0}>{t("designOverlayNone")}</option>
          {OVERLAY_ALPHAS.map((alpha) => (
            <option key={alpha} value={alpha}>
              {alpha}%
            </option>
          ))}
        </select>
      </Field>
      {overlay ? (
        <ColourField
          dataName="slider-overlay-color"
          label={t("designOverlayColour")}
          value={overlay.color}
          ctx={ctx}
          t={t}
          clearable={false}
          onChange={(color) => color && setOverlay({ color, alpha: overlay.alpha })}
        />
      ) : null}

      <ColourField
        dataName="slider-text-colour"
        label={t("sliderTextColour")}
        value={slide.text}
        ctx={ctx}
        t={t}
        automatic={{ label: t("sliderTextAuto") }}
        onChange={(colour) => onChange((content) => setSlideTextColour(content, id, colour))}
        status={textIssue ? { tone: "bad", text: t("sliderTextInsufficient") } : null}
      />

      <Field label={t("designAlign")}>
        <Segmented
          value={slide.align ?? "start"}
          onChange={(align) => onChange((content) => setSlideAlign(content, id, align))}
          options={ALIGNS.map((align) => ({ id: align, label: t(ALIGN_LABEL[align]) }))}
        />
      </Field>

      {status !== "none" && status !== "textIssue" ? (
        <p
          data-picture-status={status}
          role={status === "ok" || status === "checking" ? "status" : "alert"}
          className={`flex flex-wrap items-center gap-2 text-[12px] leading-5 ${
            status === "ok" ? "text-positive" : status === "checking" ? "text-muted" : "text-negative"
          }`}
        >
          <span>
            {status === "ok"
              ? t("designPictureOk")
              : status === "checking"
                ? t("designPictureChecking")
                : status === "noEvidence"
                  ? t("designPictureNoEvidence")
                  : t("designPictureUnprovable")}
          </span>
          {status === "unprovable" && (overlay?.alpha ?? 0) < 90 ? (
            <button
              type="button"
              data-slider-overlay-darker=""
              className="border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-text hover:bg-background"
              onClick={() =>
                setOverlay({
                  color: overlay?.color ?? { role: "overlay" },
                  alpha: Math.min(90, (overlay?.alpha ?? 20) + 20) as MediaOverlay["alpha"],
                })
              }
            >
              {t("designPictureDarker")}
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
