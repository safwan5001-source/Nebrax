/**
 * CUST-HV V4a — `MediaRef` (contract: docs/plans/store/CUST-HV-V0-DECISIONS-AND-
 * ARCHITECTURE-CONTRACT.md §3.2, §7.5–§7.8).
 *
 * A reference to a Customizer media asset plus its framing **on this usage**.
 * Never a URL, path, size or luminance — those are derived from the id (§7.8).
 *
 * Twin of `web/src/modules/store-experience-builder/presentation/media-ref.ts`
 * and `storefront/src/lib/presentation/media-ref.ts`, and of PHP
 * `StorefrontMediaRefNormalizer` (the authority). All three are pinned by
 * `tests/Fixtures/presentation/media-ref.json`. Keep the two TS files
 * byte-identical.
 *
 * Normalisation is lenient and deterministic (a Draft is never rejected): an
 * invalid field is dropped on its own, an invalid id drops the whole ref, and
 * defaults are never stored (`fit: cover`, centred focal, `rotate: 0`,
 * `zoom: 1`) so equivalent documents compare equal.
 */

export const MEDIA_ALT_MAX = 150;
export const MEDIA_ROTATIONS = [0, 90, 180, 270] as const;
export const MEDIA_ASPECTS = [
  "16:5",
  "3:1",
  "16:9",
  "4:3",
  "1:1",
  "4:5",
  "free-locked",
] as const;
export type MediaAspect = (typeof MEDIA_ASPECTS)[number];

export interface MediaCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  aspect: MediaAspect;
  /** 1–4; omitted when 1. Part of the transform identity (AMEND-11). */
  zoom?: number;
}

export interface LocalizedAlt {
  ar?: string;
  en?: string;
}

export interface MediaRef {
  mediaId: string;
  fit?: "contain";
  focal?: { x: number; y: number };
  crop?: MediaCrop;
  rotate?: 90 | 180 | 270;
  alt?: LocalizedAlt;
  decorative?: true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIN_CROP_SIDE = 0.01;
const PHP_TRIM_CHARS = new Set([" ", "\t", "\n", "\r", "\0", "\x0B"]);

function phpTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && PHP_TRIM_CHARS.has(value[start])) start += 1;
  while (end > start && PHP_TRIM_CHARS.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PHP `round($x, $dp)` — half away from zero, on the decimal representation. */
function roundHalfAway(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const shifted = Math.abs(value) * factor;
  // `toPrecision(15)` strips binary noise (1.0005 * 1e4 = 10004.999…) the way PHP's pre-rounding does.
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  return (Math.sign(value) * rounded) / factor;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeFocal(raw: unknown): { x: number; y: number } | null {
  if (!isRecord(raw)) return null;
  if (Object.keys(raw).some((key) => key !== "x" && key !== "y")) return null;
  const { x, y } = raw;
  if (!isNumber(x) || !isNumber(y)) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  const point = { x: roundHalfAway(x, 0), y: roundHalfAway(y, 0) };
  return point.x === 50 && point.y === 50 ? null : point;
}

function normalizeCrop(raw: unknown): MediaCrop | null {
  if (!isRecord(raw)) return null;
  const allowed = new Set(["x", "y", "w", "h", "aspect", "zoom"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;

  const rect: Record<"x" | "y" | "w" | "h", number> = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };
  for (const side of ["x", "y", "w", "h"] as const) {
    const value = raw[side];
    if (!isNumber(value)) return null;
    rect[side] = roundHalfAway(value, 4);
  }
  if (rect.x < 0 || rect.x > 1 || rect.y < 0 || rect.y > 1) return null;
  if (rect.w < MIN_CROP_SIDE || rect.w > 1) return null;
  if (rect.h < MIN_CROP_SIDE || rect.h > 1) return null;
  if (rect.x + rect.w > 1 + 1e-9 || rect.y + rect.h > 1 + 1e-9) return null;

  const aspect = raw.aspect;
  if (
    typeof aspect !== "string" ||
    !(MEDIA_ASPECTS as readonly string[]).includes(aspect)
  ) {
    return null;
  }

  const zoomRaw = raw.zoom ?? 1;
  if (!isNumber(zoomRaw) || zoomRaw < 1 || zoomRaw > 4) return null;
  const zoom = roundHalfAway(zoomRaw, 2);

  const crop: MediaCrop = { ...rect, aspect: aspect as MediaAspect };
  if (zoom !== 1) crop.zoom = zoom;
  return crop;
}

function normalizeRotate(raw: unknown): 90 | 180 | 270 | null {
  if (!isNumber(raw) || !Number.isInteger(raw)) return null;
  return raw === 90 || raw === 180 || raw === 270 ? raw : null;
}

function normalizeAlt(raw: unknown): LocalizedAlt | null {
  if (!isRecord(raw)) return null;
  const out: LocalizedAlt = {};
  for (const locale of ["ar", "en"] as const) {
    const value = raw[locale];
    if (typeof value !== "string") continue;
    const flattened = phpTrim(value.replace(/\p{Cc}+/gu, " "));
    const capped = Array.from(flattened).slice(0, MEDIA_ALT_MAX).join("");
    if (capped !== "") out[locale] = capped;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** `null` = not a usable reference (the whole ref is dropped). */
export function normalizeMediaRef(raw: unknown): MediaRef | null {
  if (!isRecord(raw) || typeof raw.mediaId !== "string") return null;
  const mediaId = phpTrim(raw.mediaId).toLowerCase();
  if (!UUID.test(mediaId)) return null;

  const ref: MediaRef = { mediaId };
  if (raw.fit === "contain") ref.fit = "contain";

  const focal = normalizeFocal(raw.focal);
  if (focal) ref.focal = focal;
  const crop = normalizeCrop(raw.crop);
  if (crop) ref.crop = crop;
  const rotate = normalizeRotate(raw.rotate);
  if (rotate) ref.rotate = rotate;
  const alt = normalizeAlt(raw.alt);
  if (alt) ref.alt = alt;
  if (raw.decorative === true) ref.decorative = true;

  return ref;
}

/** What a usage resolves to once the server has joined it with the library (see `presentation_media`). */
export interface ResolvedMediaSource {
  kind: "w" | "thumb";
  width: number;
  height: number;
  format: "webp" | "jpg";
  /** Same-origin proxy path — the only form a browser may ever see (AMEND-1). */
  src: string;
}

export interface ResolvedMedia {
  width: number;
  height: number;
  decorative: boolean;
  alt: { ar: string | null; en: string | null };
  sources: ResolvedMediaSource[];
}

/** Resolved media keyed by the JSON path of the `MediaRef` inside the published document. */
export type ResolvedMediaMap = Record<string, ResolvedMedia>;
