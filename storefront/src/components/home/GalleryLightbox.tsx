"use client";

import { useCallback, useEffect, useRef } from "react";
import { MotionPicture, MotionToggle } from "@/components/ui/motion-picture";
import type { GalleryLabels, GalleryViewerItem } from "./GalleryClient";

const SWIPE_MIN_PX = 50;
const SWIPE_MAX_VERTICAL_PX = 75;
const FOCUSABLE =
  "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? `{${key}}`),
  );
}

/**
 * CUST-HV V8e (V0 §13.2) — the gallery's modal viewer. A real dialog: focus moves in on open and is trapped (Tab / Shift+Tab
 * cycle the three buttons), Esc and a backdrop press close it, the page behind is scroll-locked, and focus returns to the
 * picture that opened it (the parent restores it). Direction is the document's: the previous / next buttons sit on the
 * logical edges, ← / → follow the VISUAL direction (so in RTL, ← is "next"), and a swipe toward the inline-start edge goes
 * forward. Nothing animates (the viewer is the same under `prefers-reduced-motion`).
 *
 * AWJ-ANIMATED-MEDIA — an animated picture is drawn by `MotionPicture`, exactly as in the grid (still first, reduced-motion poster,
 * animation added once hydrated). It carries the gallery's motion identity, so a picture the visitor already paused / that already
 * used its bounded window stays still here; with `showMotionControls` the same pause/play control sits in the viewer.
 */
export function GalleryLightbox({
  items,
  index,
  onIndex,
  onClose,
  labels,
  dir,
  motionToggleId,
}: {
  items: GalleryViewerItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  labels: GalleryLabels;
  dir: "ltr" | "rtl";
  motionToggleId?: string;
}) {
  const total = items.length;
  const item = items[index];
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const pressedOnBackdrop = useRef(false);

  const go = useCallback(
    (delta: number) => {
      if (total > 1) onIndex((index + delta + total) % total);
    },
    [index, onIndex, total],
  );

  // scroll lock + initial focus
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  // neighbours are fetched ahead so a step shows the picture at once
  useEffect(() => {
    if (total < 2) return;
    for (const delta of [1, -1]) {
      const neighbour = items[(index + delta + total) % total];
      if (neighbour) new Image().src = neighbour.src;
    }
  }, [index, items, total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const visualRight = event.key === "ArrowRight";
        // visual direction: toward the inline-end edge is "next"
        go(visualRight === (dir === "ltr") ? 1 : -1);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        ).filter((element) => element.getAttribute("aria-hidden") !== "true");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!rootRef.current?.contains(active)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dir, go, onClose]);

  if (!item) return null;

  const viewerPicture = (
    <>
      {item.webp ? (
        <source type="image/webp" srcSet={item.webp} sizes="100vw" />
      ) : null}
      <img
        key={item.src}
        src={item.src}
        srcSet={item.jpg || undefined}
        sizes="100vw"
        width={item.width}
        height={item.height}
        alt={item.alt}
        decoding="async"
      />
    </>
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.viewer}
      data-gallery-viewer=""
      dir={dir}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnBackdrop.current) {
          onClose();
        }
        pressedOnBackdrop.current = false;
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch || total < 2) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (
          Math.abs(dx) < SWIPE_MIN_PX ||
          Math.abs(dy) > SWIPE_MAX_VERTICAL_PX
        ) {
          return;
        }
        pressedOnBackdrop.current = false;
        // a swipe toward the inline-start edge goes forward (leftward in LTR, rightward in RTL)
        go(dx < 0 === (dir === "ltr") ? 1 : -1);
      }}
    >
      <button
        ref={closeRef}
        type="button"
        data-gallery-viewer-close=""
        aria-label={labels.close}
        onClick={onClose}
      >
        <Cross />
      </button>
      {total > 1 ? (
        <>
          <button
            type="button"
            data-gallery-viewer-nav="previous"
            aria-label={labels.viewerPrevious}
            onClick={() => go(-1)}
          >
            <Chevron />
          </button>
          <button
            type="button"
            data-gallery-viewer-nav="next"
            aria-label={labels.viewerNext}
            onClick={() => go(1)}
          >
            <Chevron />
          </button>
        </>
      ) : null}
      {motionToggleId && item.motion ? (
        <MotionToggle id={motionToggleId} />
      ) : null}
      <figure data-gallery-viewer-figure="">
        {item.motion ? (
          <MotionPicture
            key={item.src}
            id={item.motion.id}
            sources={item.motion.sources}
            autoStopMs={item.motion.autoStopMs}
          >
            {viewerPicture}
          </MotionPicture>
        ) : (
          <picture>{viewerPicture}</picture>
        )}
        {item.caption ? <figcaption>{item.caption}</figcaption> : null}
      </figure>
      <p data-gallery-viewer-count="" role="status" aria-live="polite">
        {fill(labels.counter, { current: index + 1, total })}
      </p>
    </div>
  );
}

function Cross() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      className="size-6 stroke-current"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      className="size-6 stroke-current"
    >
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
