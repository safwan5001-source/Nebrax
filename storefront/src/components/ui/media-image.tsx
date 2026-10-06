import type { CSSProperties } from "react";
import type {
  LocalizedAlt,
  ResolvedMedia,
  ResolvedMediaSource,
} from "@/lib/presentation/media-ref";
import { cn } from "@/lib/utils";

/**
 * CUST-HV V4a — renders a resolved Customizer media usage (V0 §7.8, AMEND-10/12/14).
 *
 *  - WebP in a `<source>` with a JPEG `<img>` fallback; the format is chosen by
 *    the browser from explicit, separate URLs (no `Accept` negotiation).
 *  - `srcset` from the real rendered widths; `width`/`height` always present, so
 *    there is no layout shift.
 *  - Alt is resolved **per locale**: the usage's own text, else the library
 *    default for that same locale — Arabic never stands in for English. A
 *    decorative usage always renders `alt=""` (the attribute is present, never
 *    omitted, so assistive tech skips it).
 *  - `fit` / `focal` are the usage's own (`object-fit` / `object-position`).
 */
export interface MediaImageProps {
  media: ResolvedMedia;
  locale: "ar" | "en" | string;
  /** The usage's own alt override (from the `MediaRef`), if any. */
  alt?: LocalizedAlt;
  /** Used only when the usage is informative and no alt resolves for this locale. */
  fallbackAlt?: string;
  fit?: "contain";
  focal?: { x: number; y: number };
  sizes?: string;
  className?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}

export function resolveMediaAlt(
  media: ResolvedMedia,
  locale: string,
  override?: LocalizedAlt,
  fallback = "",
): string {
  if (media.decorative) return "";
  const key = locale === "ar" ? "ar" : "en";
  // `media.alt` already merged usage → library per locale on the server; the
  // optional override lets a caller that holds the ref (draft preview) do the same.
  return override?.[key]?.trim() || media.alt[key] || fallback;
}

function srcSet(sources: ResolvedMediaSource[], format: "webp" | "jpg") {
  return sources
    .filter((s) => s.kind === "w" && s.format === format)
    .map((s) => `${s.src} ${s.width}w`)
    .join(", ");
}

export function MediaImage({
  media,
  locale,
  alt,
  fallbackAlt,
  fit,
  focal,
  sizes,
  className,
  loading = "lazy",
  fetchPriority,
}: MediaImageProps) {
  const webp = srcSet(media.sources, "webp");
  const jpg = srcSet(media.sources, "jpg");
  const widths = media.sources.filter((s) => s.kind === "w");
  const fallback =
    widths.filter((s) => s.format === "jpg").at(-1) ??
    widths.at(-1) ??
    media.sources[0];

  const style: CSSProperties = {
    objectFit: fit === "contain" ? "contain" : "cover",
    ...(focal ? { objectPosition: `${focal.x}% ${focal.y}%` } : {}),
  };

  return (
    <picture>
      {webp ? <source type="image/webp" srcSet={webp} sizes={sizes} /> : null}
      <img
        src={fallback.src}
        srcSet={jpg || undefined}
        sizes={sizes}
        width={media.width}
        height={media.height}
        alt={resolveMediaAlt(media, locale, alt, fallbackAlt)}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        className={cn(className)}
        style={style}
      />
    </picture>
  );
}
