import type { CSSProperties } from "react";
import {
  MOTION_TOGGLE_STYLE,
  MotionPicture,
  MotionToggle,
} from "@/components/ui/motion-picture";
import { animatedPictureSources } from "@/lib/presentation/animated-sources";
import type { SectionBackdropData } from "@/lib/presentation/background-media";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";

/**
 * CUST-HV V6b-3 (V0 §8.1) — the picture behind a hero or banner: a decorative `<picture>` (WebP with
 * a JPEG fallback, real rendered widths) plus an optional colour-wash layer. The phone picture is
 * art direction, not a second image on the page: `<source media>` entries ahead of the default ones,
 * so the browser fetches exactly one file.
 *
 * It is purely presentational — `aria-hidden`, `alt=""`, no pointer events — and takes its colour and
 * strength from the validated tokens on the section's design frame (`--sec-ovl` / `--sec-ovl-a`, see
 * the `data-sd-backdrop` rules in globals.css). The first hero is the page's largest contentful paint,
 * so it loads eagerly with a high fetch priority; everything else is lazy.
 */
const PHONE = "(max-width: 767px)";

function srcSet(media: ResolvedMedia, format: "webp" | "jpg"): string {
  return media.sources
    .filter((s) => s.kind === "w" && s.format === format)
    .map((s) => `${s.src} ${s.width}w`)
    .join(", ");
}

export function SectionBackdrop({
  data,
  priority = false,
}: {
  data: SectionBackdropData;
  priority?: boolean;
}) {
  const { media, mobile } = data;
  const widths = media.sources.filter((s) => s.kind === "w");
  const fallback =
    widths.filter((s) => s.format === "jpg").at(-1) ??
    widths.at(-1) ??
    media.sources[0];
  // Each picture is framed by its own focal point, switched at the same breakpoint as the sources
  // (the `object-position` rules live with the backdrop CSS; only validated integers are written).
  const position = (focal?: { x: number; y: number }) =>
    focal ? `${focal.x}% ${focal.y}%` : "50% 50%";
  const style = {
    "--sd-pos": position(data.focal),
    ...(mobile ? { "--sd-pos-m": position(data.mobileFocal) } : {}),
  } as CSSProperties;
  const mobileWebp = mobile ? srcSet(mobile, "webp") : "";
  const mobileJpg = mobile ? srcSet(mobile, "jpg") : "";
  const webp = srcSet(media, "webp");

  const phoneStills = (
    <>
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
    </>
  );
  const desktopStills = (
    <>
      {webp ? <source type="image/webp" srcSet={webp} sizes="100vw" /> : null}
      {/* biome-ignore lint/performance/noImgElement: the <img> of a <picture> art-direction set (rendered inside it) */}
      <img
        src={fallback.src}
        srcSet={srcSet(media, "jpg") || undefined}
        sizes="100vw"
        width={media.width}
        height={media.height}
        alt=""
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </>
  );

  // AWJ-ANIMATED-MEDIA P1 — an animated GIF/WebP plays here; the still ladder stays the default for
  // reduced motion, paused and unsupported browsers. With no animation the markup is exactly the original.
  const motion = animatedPictureSources(media, mobile);
  const motionId = media.animation?.src ?? mobile?.animation?.src ?? "";

  return (
    <>
      <div data-sd-backdrop="" aria-hidden="true" style={style}>
        {motion ? (
          <MotionPicture
            id={motionId}
            sources={motion}
            phoneStills={phoneStills}
          >
            {desktopStills}
          </MotionPicture>
        ) : (
          <picture>
            {phoneStills}
            {desktopStills}
          </picture>
        )}
        {data.overlay ? <div data-sd-overlay="" /> : null}
      </div>
      {motion ? (
        <MotionToggle id={motionId} style={MOTION_TOGGLE_STYLE} />
      ) : null}
    </>
  );
}
