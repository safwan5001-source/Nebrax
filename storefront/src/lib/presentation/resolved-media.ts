/**
 * CUST-HV V4a — the storefront's reading of `data.presentation_media`: the
 * server's join of every published `MediaRef` with the media library, keyed by
 * the JSON path of the reference inside the published document.
 *
 * Defensive on purpose: the payload crosses a network boundary, and an entry
 * that does not match the contract is *dropped* (the renderer then falls back
 * to the legacy field or to nothing) — it is never repaired or guessed. Only the
 * same-origin proxy path is accepted as a `src` (AMEND-1): a raw origin path, an
 * absolute URL or a traversal can never reach an `<img>`.
 */
import {
  AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX,
  customizerMediaPath,
  isCustomizerMediaFile,
  isCustomizerMediaId,
} from "@/lib/commerce/customizer-media";
import type { StorefrontPresentationConfig } from "./config";
import type {
  MediaRef,
  ResolvedMedia,
  ResolvedMediaMap,
  ResolvedMediaSource,
} from "./media-ref";

const FORMATS = new Set(["webp", "jpg"]);
const KINDS = new Set(["w", "thumb"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readSource(raw: unknown): ResolvedMediaSource | null {
  if (!isRecord(raw)) return null;
  const width = positiveInt(raw.width);
  const height = positiveInt(raw.height);
  if (width === null || height === null) return null;
  if (typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
  if (typeof raw.format !== "string" || !FORMATS.has(raw.format)) return null;
  if (typeof raw.src !== "string") return null;
  if (!raw.src.startsWith(AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX)) return null;

  const [id, file, ...rest] = raw.src
    .slice(AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX.length)
    .split("/");
  if (rest.length > 0 || !id || !file) return null;
  if (!isCustomizerMediaId(id) || !isCustomizerMediaFile(file)) return null;
  // Re-derive rather than echo, so what is rendered is exactly the contract form.
  const src = customizerMediaPath(id, file);
  if (src === null) return null;

  return {
    kind: raw.kind as "w" | "thumb",
    width,
    height,
    format: raw.format as "webp" | "jpg",
    src,
  };
}

export function readResolvedMedia(raw: unknown): ResolvedMediaMap {
  if (!isRecord(raw)) return {};

  const out: ResolvedMediaMap = {};
  for (const [path, value] of Object.entries(raw)) {
    if (!isRecord(value) || !Array.isArray(value.sources)) continue;
    const width = positiveInt(value.width);
    const height = positiveInt(value.height);
    if (width === null || height === null) continue;

    const sources = value.sources
      .map(readSource)
      .filter((source): source is ResolvedMediaSource => source !== null);
    if (sources.length === 0) continue;

    const alt = isRecord(value.alt) ? value.alt : {};
    out[path] = {
      width,
      height,
      decorative: value.decorative === true,
      alt: { ar: nullableText(alt.ar), en: nullableText(alt.en) },
      sources,
    };
  }
  return out;
}

export interface PublishedMedia {
  ref: MediaRef;
  media: ResolvedMedia;
}

/** A reference and what the server resolved for it, or `null` — callers fall back, never guess. */
export function publishedMedia(
  presentation: StorefrontPresentationConfig | null,
  resolved: ResolvedMediaMap,
  path: string,
): PublishedMedia | null {
  if (!presentation) return null;
  const [section, key] = path.split(".");
  const ref =
    section === "branding" && key
      ? (
          presentation.branding as unknown as Record<
            string,
            MediaRef | undefined
          >
        )[key]
      : undefined;
  const media = resolved[path];
  return ref && media ? { ref, media } : null;
}

export function publishedLogoMedia(
  presentation: StorefrontPresentationConfig | null,
  resolved: ResolvedMediaMap,
  compact = false,
): PublishedMedia | null {
  // The compact logo applies only when set; otherwise the main logo, exactly
  // like the legacy fields (`publishedLogoUrl`).
  return (
    (compact
      ? publishedMedia(presentation, resolved, "branding.compactLogoMedia")
      : null) ?? publishedMedia(presentation, resolved, "branding.logoMedia")
  );
}

/** Thumbnail source for the browser tab icon: the 320 px thumb, WebP first. */
export function publishedFaviconSource(
  presentation: StorefrontPresentationConfig | null,
  resolved: ResolvedMediaMap,
): string | null {
  const found =
    publishedMedia(presentation, resolved, "branding.faviconMedia") ??
    publishedLogoMedia(presentation, resolved);
  if (!found) return null;

  const thumbs = found.media.sources.filter((s) => s.kind === "thumb");
  const pool = thumbs.length > 0 ? thumbs : found.media.sources;
  const pick =
    pool.filter((s) => s.format === "webp").at(-1) ?? pool.at(-1) ?? null;
  return pick ? pick.src : null;
}
