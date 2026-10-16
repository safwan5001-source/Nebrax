/**
 * AWJ-ANIMATED-MEDIA P1 — the extra `<source>` entries a `<picture>` needs to play a GIF / animated WebP,
 * while keeping the still ladder (first frame) as the default, the no-support fallback and the
 * `prefers-reduced-motion` rendition.
 *
 * `<picture>` takes the first `<source>` whose `media` and `type` match, so ORDER is the contract:
 *
 *   1. reduced-motion poster (phone, then desktop) — a visitor who asks for less motion never fetches the animation;
 *   2. animated phone picture (only when the phone picture itself is animated);
 *   3. …the caller's existing phone-sized stills…
 *   4. animated desktop picture (only when the desktop picture is animated);
 *   5. …the caller's existing desktop WebP source and `<img>` (the still ladder; also what a browser that
 *      cannot decode the animated format falls back to).
 *
 * `leading` is slots 1–2, `beforeDesktop` is slot 4. For a document with no animation both are empty and
 * callers render exactly what they rendered before.
 */
import type { ResolvedMedia, ResolvedMediaSource } from "./media-ref";

export const PHONE_QUERY = "(max-width: 767px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface PictureSource {
  media?: string;
  type: string;
  srcSet: string;
  sizes?: string;
  /** `true` ⇒ dropped while the visitor has paused the animation. */
  animated: boolean;
}

export interface AnimatedPictureSources {
  leading: PictureSource[];
  beforeDesktop: PictureSource[];
}

function stills(
  sources: ResolvedMediaSource[],
  format: "webp" | "jpg",
): string {
  return sources
    .filter((s) => s.kind === "w" && s.format === format)
    .map((s) => `${s.src} ${s.width}w`)
    .join(", ");
}

function mimeOf(media: ResolvedMedia): string {
  return media.animation?.format === "gif" ? "image/gif" : "image/webp";
}

export function isAnimatedMedia(
  media: ResolvedMedia | null | undefined,
): boolean {
  return Boolean(media?.animation);
}

/** `null` when neither picture is animated — the caller keeps its original markup. */
export function animatedPictureSources(
  desktop: ResolvedMedia,
  mobile: ResolvedMedia | undefined,
  sizes = "100vw",
): AnimatedPictureSources | null {
  if (!desktop.animation && !mobile?.animation) return null;

  const leading: PictureSource[] = [];
  const poster = (media: ResolvedMedia, query: string) => {
    for (const [format, type] of [
      ["webp", "image/webp"],
      ["jpg", "image/jpeg"],
    ] as const) {
      const srcSet = stills(media.sources, format);
      if (srcSet)
        leading.push({ media: query, type, srcSet, sizes, animated: false });
    }
  };

  if (mobile) poster(mobile, `${REDUCED_MOTION_QUERY} and ${PHONE_QUERY}`);
  poster(desktop, REDUCED_MOTION_QUERY);

  if (mobile?.animation) {
    leading.push({
      media: PHONE_QUERY,
      type: mimeOf(mobile),
      srcSet: mobile.animation.src,
      animated: true,
    });
  }
  const beforeDesktop: PictureSource[] = desktop.animation
    ? [{ type: mimeOf(desktop), srcSet: desktop.animation.src, animated: true }]
    : [];

  return { leading, beforeDesktop };
}
