/**
 * CUST-HV V4b — pure geometry for the bounded image editor (V0 §7.6).
 *
 * Coordinates are **normalised (0–1) on the image after EXIF orientation and
 * user rotation** — the frame the editor shows and the server crops in (V2b,
 * AWJ decision 3). The editor never touches pixels: it only produces the
 * `MediaRef` framing fields; V2b renders them.
 *
 * Deliberately small: a crop locked to an aspect preset (largest rectangle,
 * moved — never free-resized), zoom 1–4×, focal 0–100, fit, 90° rotation.
 */

import type { MediaAspect, MediaCrop, MediaRef } from "../presentation/media-ref";

export const EDITOR_ASPECTS = ["16:5", "3:1", "16:9", "4:3", "1:1", "4:5"] as const;
export type EditorAspect = (typeof EDITOR_ASPECTS)[number];

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;
export const NUDGE_STEP = 0.01;

export type Rotation = 0 | 90 | 180 | 270;

export interface Dims {
  w: number;
  h: number;
}

/** Image dimensions after rotation (90/270 swap the axes). */
export function rotatedDims(natural: Dims, rotate: Rotation): Dims {
  return rotate === 90 || rotate === 270
    ? { w: natural.h, h: natural.w }
    : { w: natural.w, h: natural.h };
}

export function nextRotation(rotate: Rotation): Rotation {
  return ((rotate + 90) % 360) as Rotation;
}

export function aspectValue(aspect: MediaAspect, fallback = 1): number {
  const m = /^(\d+):(\d+)$/.exec(aspect);
  if (!m) return fallback;
  return Number(m[1]) / Number(m[2]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 4 dp — the same precision the contract stores (identity is a hash of it). */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The largest rectangle of `aspect` (a pixel ratio) that fits the rotated
 * image, centred. Returned normalised.
 */
export function maxCrop(aspect: EditorAspect, rotated: Dims, zoom = 1): MediaCrop {
  const ratio = aspectValue(aspect);
  const imageRatio = rotated.w / rotated.h;
  let w: number;
  let h: number;
  if (imageRatio > ratio) {
    // image is wider than the frame → full height
    h = 1;
    w = (ratio * rotated.h) / rotated.w;
  } else {
    w = 1;
    h = rotated.w / ratio / rotated.h;
  }
  const crop: MediaCrop = {
    x: round4((1 - w) / 2),
    y: round4((1 - h) / 2),
    w: round4(w),
    h: round4(h),
    aspect,
  };
  if (zoom > 1) crop.zoom = zoom;
  return crop;
}

/** Keep the rectangle inside the image. */
export function clampCrop(crop: MediaCrop): MediaCrop {
  const w = clamp(crop.w, 0.01, 1);
  const h = clamp(crop.h, 0.01, 1);
  return {
    ...crop,
    w: round4(w),
    h: round4(h),
    x: round4(clamp(crop.x, 0, 1 - w)),
    y: round4(clamp(crop.y, 0, 1 - h)),
  };
}

export function moveCrop(crop: MediaCrop, dx: number, dy: number): MediaCrop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

export function setZoom(crop: MediaCrop, zoom: number): MediaCrop {
  const z = round2(clamp(zoom, ZOOM_MIN, ZOOM_MAX));
  const next: MediaCrop = { ...crop };
  if (z > 1) next.zoom = z;
  else delete next.zoom;
  return next;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Snap anchors of the 3×3 focal grid. */
export const FOCAL_SNAPS = [
  [0, 0], [50, 0], [100, 0],
  [0, 50], [50, 50], [100, 50],
  [0, 100], [50, 100], [100, 100],
] as const;

export function focalFromPoint(px: number, py: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const x = rect.width > 0 ? ((px - rect.left) / rect.width) * 100 : 50;
  const y = rect.height > 0 ? ((py - rect.top) / rect.height) * 100 : 50;
  return { x: Math.round(clamp(x, 0, 100)), y: Math.round(clamp(y, 0, 100)) };
}

/** What the editor edits — a framing, independent of alt/decorative. */
export interface Framing {
  crop?: MediaCrop;
  rotate: Rotation;
  focal: { x: number; y: number };
  fit: "cover" | "contain";
}

export const DEFAULT_FRAMING: Framing = {
  rotate: 0,
  focal: { x: 50, y: 50 },
  fit: "cover",
};

export function framingOf(ref: MediaRef | null | undefined): Framing {
  return {
    crop: ref?.crop,
    rotate: (ref?.rotate ?? 0) as Rotation,
    focal: ref?.focal ?? { x: 50, y: 50 },
    fit: ref?.fit ?? "cover",
  };
}

export function isDefaultFraming(f: Framing): boolean {
  return (
    !f.crop &&
    f.rotate === 0 &&
    f.focal.x === 50 &&
    f.focal.y === 50 &&
    f.fit === "cover"
  );
}

/**
 * Apply a framing onto a ref, **omitting defaults** (the contract never stores
 * them — equivalent documents must compare equal). Alt/decorative untouched.
 */
export function applyFraming(ref: MediaRef, f: Framing): MediaRef {
  const { crop: _c, rotate: _r, focal: _f, fit: _fit, ...rest } = ref;
  void _c; void _r; void _f; void _fit;
  const next: MediaRef = { ...rest };
  if (f.fit === "contain") next.fit = "contain";
  if (f.focal.x !== 50 || f.focal.y !== 50) next.focal = { x: f.focal.x, y: f.focal.y };
  if (f.crop) next.crop = f.crop;
  if (f.rotate !== 0) next.rotate = f.rotate as 90 | 180 | 270;
  return reorder(next);
}

/** Fixed key order, like the PHP authority. */
function reorder(ref: MediaRef): MediaRef {
  const out: MediaRef = { mediaId: ref.mediaId };
  if (ref.fit) out.fit = ref.fit;
  if (ref.focal) out.focal = ref.focal;
  if (ref.crop) out.crop = ref.crop;
  if (ref.rotate) out.rotate = ref.rotate;
  if (ref.alt) out.alt = ref.alt;
  if (ref.decorative) out.decorative = ref.decorative;
  return out;
}

/**
 * CSS for an image that must fill a box of the *rotated* aspect ratio. When the
 * rotation swaps the axes, the un-rotated element is `box-height × box-width`;
 * as percentages of the box that is `w/h` and `h/w` of the natural ratio. The
 * element is centred (absolute, 50%/50%) and rotated about its centre.
 */
export function rotatedImageStyle(natural: Dims, rotate: Rotation): {
  width: string;
  height: string;
  transform: string;
} {
  const swap = rotate === 90 || rotate === 270;
  const ok = natural.w > 0 && natural.h > 0;
  return {
    width: swap && ok ? `${round4((100 * natural.w) / natural.h)}%` : "100%",
    height: swap && ok ? `${round4((100 * natural.h) / natural.w)}%` : "100%",
    transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
  };
}
