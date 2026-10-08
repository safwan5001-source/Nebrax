"use client";

/**
 * CUST-HV V4b — bounded image editor (V0 §7.6).
 *
 * Edits **this usage's framing only** — the library original never changes —
 * and returns a `MediaRef`; it never touches pixels (V2b renders the framing).
 * Crop is a rectangle *locked to an aspect preset* that is moved, never
 * free-resized; zoom 1–4× lives in the crop; focal 0–100 is set by click on the
 * result frame or a 3×3 snap; fit; 90° rotation; Reset always available.
 * No filters, flips, shapes or resize handles (rejected in V0).
 *
 * Everything is keyboard operable: arrows nudge the crop (Shift = larger step),
 * `+`/`-` zoom, the focal grid and every preset are real buttons.
 */
import { RefreshCw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { StorefrontMediaAsset } from "@/modules/commerce-workspace/storefront-media";
import type { CustomizerMessageKey } from "../messages";
import type { MediaAspect, MediaCrop, MediaRef } from "../presentation/media-ref";
import {
  DEFAULT_FRAMING,
  EDITOR_ASPECTS,
  FOCAL_SNAPS,
  NUDGE_STEP,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  applyFraming,
  aspectValue,
  focalFromPoint,
  framingOf,
  isDefaultFraming,
  maxCrop,
  moveCrop,
  nextRotation,
  rotatedDims,
  rotatedImageStyle,
  setZoom,
  type EditorAspect,
  type Framing,
} from "./framing";
import { MediaDialog } from "./MediaDialog";
import { mediaBtnClass, mediaPrimaryBtnClass } from "./ui";

type T = (key: CustomizerMessageKey) => string;

const ROW_KEYS = ["mediaRowTop", "mediaRowMiddle", "mediaRowBottom"] as const;
const COL_KEYS = ["mediaColLeft", "mediaColCenter", "mediaColRight"] as const;

export function MediaFramingEditor({
  open,
  onClose,
  value,
  asset,
  onApply,
  t,
  locale,
  coverOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  value: MediaRef;
  asset: StorefrontMediaAsset;
  onApply: (next: MediaRef) => void;
  t: T;
  locale: "ar" | "en";
  /** A background picture is always painted `cover` (letterboxing would reveal an unproven surface): no Contain choice. */
  coverOnly?: boolean;
}) {
  const [framing, setFraming] = useState<Framing>(() => ({
    ...framingOf(value),
    ...(coverOnly ? { fit: "cover" as const } : {}),
  }));
  const natural = useMemo(() => ({ w: asset.width, h: asset.height }), [asset.width, asset.height]);
  const rotated = rotatedDims(natural, framing.rotate);
  const aspect: EditorAspect | null =
    framing.crop && (EDITOR_ASPECTS as readonly string[]).includes(framing.crop.aspect)
      ? (framing.crop.aspect as EditorAspect)
      : null;
  const zoom = framing.crop?.zoom ?? 1;

  function choose(next: EditorAspect | "original") {
    setFraming((f) => {
      if (next === "original") return { ...f, crop: undefined };
      return { ...f, crop: maxCrop(next, rotatedDims(natural, f.rotate), f.crop?.zoom ?? 1) };
    });
  }

  function rotate() {
    setFraming((f) => {
      const rot = nextRotation(f.rotate);
      const dims = rotatedDims(natural, rot);
      const crop = f.crop
        ? (EDITOR_ASPECTS as readonly string[]).includes(f.crop.aspect)
          ? maxCrop(f.crop.aspect as EditorAspect, dims, f.crop.zoom ?? 1)
          : fullCrop(f.crop.zoom)
        : undefined;
      return { ...f, rotate: rot, crop };
    });
  }

  function changeZoom(next: number) {
    setFraming((f) => {
      const base: MediaCrop = f.crop ?? fullCrop();
      return { ...f, crop: setZoom(base, next) };
    });
  }

  function onSourceKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? NUDGE_STEP * 5 : NUDGE_STEP;
    const move = (dx: number, dy: number) => {
      event.preventDefault();
      setFraming((f) => (f.crop ? { ...f, crop: moveCrop(f.crop, dx, dy) } : f));
    };
    if (event.key === "ArrowLeft") move(-step, 0);
    else if (event.key === "ArrowRight") move(step, 0);
    else if (event.key === "ArrowUp") move(0, -step);
    else if (event.key === "ArrowDown") move(0, step);
    else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(zoom + ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(zoom - ZOOM_STEP);
    }
  }

  const sourceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  function onCropDown(event: PointerEvent<HTMLDivElement>) {
    if (!framing.crop) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onCropMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const box = sourceRef.current?.getBoundingClientRect();
    if (!start || !box || box.width === 0 || box.height === 0) return;
    const dx = (event.clientX - start.x) / box.width;
    const dy = (event.clientY - start.y) / box.height;
    drag.current = { x: event.clientX, y: event.clientY };
    setFraming((f) => (f.crop ? { ...f, crop: moveCrop(f.crop, dx, dy) } : f));
  }
  function onCropUp() {
    drag.current = null;
  }

  const resultRef = useRef<HTMLDivElement>(null);
  function onResultClick(event: React.MouseEvent<HTMLDivElement>) {
    const box = resultRef.current?.getBoundingClientRect();
    if (!box) return;
    const focal = focalFromPoint(event.clientX, event.clientY, box);
    setFraming((f) => ({ ...f, focal }));
  }

  const src = asset.previewUrl;
  const frameRatio = framing.crop ? aspectValue(framing.crop.aspect, rotated.w / rotated.h) : rotated.w / rotated.h;
  const reset = () => setFraming({ ...DEFAULT_FRAMING });

  return (
    <MediaDialog
      open={open}
      onClose={onClose}
      title={t("mediaEditorTitle")}
      description={t("mediaEditorIntro")}
      closeLabel={t("mediaCancel")}
      locale={locale}
      wide
      footer={
        <>
          <button type="button" className={mediaBtnClass} onClick={reset} data-media-reset="">
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("mediaReset")}
          </button>
          <span className="flex-1" />
          <button type="button" className={mediaBtnClass} onClick={onClose}>
            {t("mediaCancel")}
          </button>
          <button
            type="button"
            className={mediaPrimaryBtnClass}
            data-media-apply=""
            onClick={() => onApply(applyFraming(value, framing))}
          >
            {t("mediaApply")}
          </button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2" data-media-editor="">
        {/* Source — the crop frame moves over the (rotated) original */}
        <section className="min-w-0 space-y-2" aria-label={t("mediaSourcePreview")}>
          <h3 className="text-[12px] font-medium text-muted">{t("mediaSourcePreview")}</h3>
          <div
            ref={sourceRef}
            className="relative mx-auto w-full overflow-hidden bg-background"
            style={{
              aspectRatio: `${rotated.w} / ${rotated.h}`,
              maxWidth: `min(100%, calc(46dvh * ${rotated.w / Math.max(rotated.h, 1)}))`,
            }}
            data-media-source="" dir="ltr"
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived workspace URL
              <img
                src={src}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={rotatedImageStyle(natural, framing.rotate)}
              />
            ) : (
              <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-[12px] text-muted">
                {t("mediaNoPreview")}
              </p>
            )}
            {framing.crop ? (
              <div
                role="group"
                tabIndex={0}
                aria-label={`${t("mediaCropArea")} ${framing.crop.aspect}. ${t("mediaCropHint")}`}
                onKeyDown={onSourceKey}
                onPointerDown={onCropDown}
                onPointerMove={onCropMove}
                onPointerUp={onCropUp}
                onPointerCancel={onCropUp}
                className="absolute cursor-move touch-none border-2 border-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                style={{
                  left: `${framing.crop.x * 100}%`,
                  top: `${framing.crop.y * 100}%`,
                  width: `${framing.crop.w * 100}%`,
                  height: `${framing.crop.h * 100}%`,
                  boxShadow: "0 0 0 9999px color-mix(in srgb, var(--text) 45%, transparent)",
                }}
                data-media-crop=""
              />
            ) : null}
          </div>
          {framing.crop ? <p className="text-[11px] text-muted">{t("mediaCropHint")}</p> : null}
        </section>

        {/* Result + controls */}
        <section className="min-w-0 space-y-4">
          <div className="space-y-2">
            <h3 className="text-[12px] font-medium text-muted">{t("mediaFramePreview")}</h3>
            <div
              ref={resultRef}
              onClick={onResultClick}
              className="relative mx-auto w-full cursor-crosshair overflow-hidden bg-background"
              style={{ aspectRatio: String(frameRatio), maxWidth: `min(100%, calc(32dvh * ${frameRatio}))` }}
              data-media-result="" dir="ltr"
              aria-label={t("mediaFocalHint")}
              role="img"
            >
              {src ? (
                <ResultImage src={src} natural={natural} framing={framing} />
              ) : null}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary-foreground bg-primary"
                style={{ left: `${framing.focal.x}%`, top: `${framing.focal.y}%` }}
                data-media-focal-marker=""
              />
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[12px] font-medium text-muted">{t("mediaAspect")}</legend>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={!framing.crop}
                onClick={() => choose("original")}
                className={`${mediaBtnClass} ${!framing.crop ? "border-primary bg-primary-soft" : ""}`}
              >
                {t("mediaAspectOriginal")}
              </button>
              {EDITOR_ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={aspect === a}
                  onClick={() => choose(a)}
                  dir="ltr"
                  className={`${mediaBtnClass} tabular-nums ${aspect === a ? "border-primary bg-primary-soft" : ""}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="media-zoom" className="block text-[12px] font-medium text-muted">
              {t("mediaZoom")}{" "}
              <span className="tabular-nums" dir="ltr">
                {zoom.toFixed(2).replace(/\.?0+$/, "")}×
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={mediaBtnClass}
                aria-label={t("mediaZoomOut")}
                disabled={zoom <= ZOOM_MIN}
                onClick={() => changeZoom(zoom - ZOOM_STEP)}
              >
                <ZoomOut aria-hidden="true" className="size-4" />
              </button>
              <input
                id="media-zoom"
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={zoom}
                aria-label={t("mediaZoomValue")}
                onChange={(e) => changeZoom(Number(e.target.value))}
                className="min-w-0 flex-1 accent-[var(--primary)]"
              />
              <button
                type="button"
                className={mediaBtnClass}
                aria-label={t("mediaZoomIn")}
                disabled={zoom >= ZOOM_MAX}
                onClick={() => changeZoom(zoom + ZOOM_STEP)}
              >
                <ZoomIn aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[12px] font-medium text-muted">{t("mediaFocal")}</legend>
              <div className="grid w-fit grid-cols-3 gap-1" data-media-focal-grid="">
                {FOCAL_SNAPS.map(([x, y], index) => {
                  const active = framing.focal.x === x && framing.focal.y === y;
                  return (
                    <button
                      key={`${x}-${y}`}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${t(ROW_KEYS[Math.floor(index / 3)])} ${t(COL_KEYS[index % 3])}`}
                      onClick={() => setFraming((f) => ({ ...f, focal: { x, y } }))}
                      className={`flex size-9 items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        active ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-background"
                      }`}
                    >
                      <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-primary" : "bg-border"}`} />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="min-w-0 flex-1 basis-40 space-y-3">
              {coverOnly ? null : (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-[12px] font-medium text-muted">{t("mediaFit")}</legend>
                <div className="flex gap-1.5">
                  {(["cover", "contain"] as const).map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      aria-pressed={framing.fit === fit}
                      onClick={() => setFraming((f) => ({ ...f, fit }))}
                      className={`${mediaBtnClass} ${framing.fit === fit ? "border-primary bg-primary-soft" : ""}`}
                    >
                      {fit === "cover" ? t("mediaFitCover") : t("mediaFitContain")}
                    </button>
                  ))}
                </div>
              </fieldset>
              )}
              <button type="button" className={mediaBtnClass} onClick={rotate} data-media-rotate="">
                <RotateCw aria-hidden="true" className="size-4" />
                {t("mediaRotate")}
              </button>
            </div>
          </div>
          {isDefaultFraming(framing) ? null : (
            <p className="sr-only" role="status">
              {t("mediaEditorTitle")}
            </p>
          )}
        </section>
      </div>
    </MediaDialog>
  );
}

function fullCrop(zoom?: number): MediaCrop {
  const crop: MediaCrop = { x: 0, y: 0, w: 1, h: 1, aspect: "free-locked" as MediaAspect };
  if (zoom && zoom > 1) crop.zoom = zoom;
  return crop;
}

/**
 * CSS approximation of what V2b renders: the crop region scaled to fill the
 * frame (cover), zoomed about the focal point; or the whole region letterboxed
 * (contain). Preview only — the pixels are made by the server.
 */
function ResultImage({
  src,
  natural,
  framing,
}: {
  src: string;
  natural: { w: number; h: number };
  framing: Framing;
}) {
  const rot = rotatedDims(natural, framing.rotate);
  const c = framing.crop ?? { x: 0, y: 0, w: 1, h: 1, aspect: "free-locked" as MediaAspect };
  const zoom = framing.crop?.zoom ?? 1;
  const img = (
    <img
      src={src}
      alt=""
      draggable={false}
      className="absolute left-1/2 top-1/2 max-w-none select-none"
      style={rotatedImageStyle(natural, framing.rotate)}
    />
  );

  if (framing.fit === "contain") {
    const region = (c.w * rot.w) / Math.max(c.h * rot.h, 1);
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative overflow-hidden"
          style={{
            aspectRatio: String(region),
            maxWidth: "100%",
            maxHeight: "100%",
            width: region >= 1 ? "100%" : "auto",
            height: region >= 1 ? "auto" : "100%",
          }}
        >
          <div
            className="absolute"
            style={{
              width: `${100 / c.w}%`,
              height: `${100 / c.h}%`,
              left: `${(-c.x / c.w) * 100}%`,
              top: `${(-c.y / c.h) * 100}%`,
            }}
          >
            {img}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0"
      style={{
        transform: zoom > 1 ? `scale(${zoom})` : undefined,
        transformOrigin: `${framing.focal.x}% ${framing.focal.y}%`,
      }}
    >
      <div
        className="absolute"
        style={{
          width: `${100 / c.w}%`,
          height: `${100 / c.h}%`,
          left: `${(-c.x / c.w) * 100}%`,
          top: `${(-c.y / c.h) * 100}%`,
        }}
      >
        {img}
      </div>
    </div>
  );
}
