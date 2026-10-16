"use client";

import { type CSSProperties, useState } from "react";
import type { SectionBackground } from "../presentation/section-design";
import { useAnimatedPreview } from "./animated-preview-store";
import { CANVAS_MOTION_TOGGLE_STYLE, CanvasMotionToggle, type CanvasMotionLabels, usePrefersReducedMotion } from "./CanvasMotion";
import { useMediaRefPreview } from "./use-media-ref-preview";

/**
 * CUST-HV V6b-4a — the Canvas's twin of the storefront's `SectionBackdrop`: the SAME
 * `data-sd-backdrop` / `data-sd-overlay` structure, so the one CSS block (kept identical in both
 * stylesheets) styles both. The picture URL is the editor-only signed workspace URL
 * (`useMediaRefPreview`); the Canvas simulates the device, so the phone picture is chosen from the
 * `viewport` prop rather than a media query against the host window. Decorative and inert.
 *
 * AWJ-ANIMATED-MEDIA — an animated GIF/WebP plays here as it does on the published page (the SAME `<picture><img>`, its `src`
 * swapped to the signed sanitised animation) with the storefront's pause/play control beside the backdrop. The still stays the
 * default for reduced motion and while paused, and the document never stores the animated URL.
 */
export function CanvasBackdrop({
  background,
  viewport,
  motionLabels,
}: {
  background: Extract<SectionBackground, { kind: "media" }>;
  viewport: "desktop" | "tablet" | "mobile";
  motionLabels?: CanvasMotionLabels;
}) {
  const defaultUrl = useMediaRefPreview(background.media);
  const phoneUrl = useMediaRefPreview(background.mobile ?? null);
  const usePhone = viewport === "mobile" && !!phoneUrl && !!background.mobile;
  const stillSrc = usePhone ? phoneUrl : defaultUrl;
  // motion: the storefront shows the control when EITHER picture is animated; the picture drawn is the device's own
  const defaultMotion = useAnimatedPreview(background.media.mediaId);
  const phoneMotion = useAnimatedPreview(background.mobile?.mediaId);
  const reduced = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const motion = usePhone ? phoneMotion : defaultMotion;
  const hasMotion = !!(defaultMotion || phoneMotion);
  const errored = !!motion && failed === motion;
  const live = playing && !reduced && !!motion && !errored;
  const src = live ? motion : stillSrc;
  if (!src) return null;
  // each picture is framed by its own focal point (centred when it has none) — the same
  // `--sd-pos` variable the storefront's backdrop CSS reads
  const focal = usePhone ? background.mobile?.focal : background.media.focal;
  const style = { "--sd-pos": focal ? `${focal.x}% ${focal.y}%` : "50% 50%" } as CSSProperties;
  return (
    <>
      <div data-sd-backdrop="" aria-hidden="true" style={style}>
        <picture>
          {/* biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import */}
          <img
            src={src}
            alt=""
            decoding="async"
            // a stale signature (they last 20 min) must not leave a broken picture: fall back to the still
            onError={live ? () => setFailed(motion) : undefined}
          />
        </picture>
        {background.overlay ? <div data-sd-overlay="" /> : null}
      </div>
      {hasMotion && !reduced && motionLabels ? (
        <CanvasMotionToggle playing={playing && !errored} onToggle={() => setPlaying((p) => !p)} labels={motionLabels} style={CANVAS_MOTION_TOGGLE_STYLE} />
      ) : null}
    </>
  );
}
