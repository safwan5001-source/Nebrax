import { Easing } from 'remotion';

export type EaseFn = (t: number) => number;

/**
 * Motion families. Objects of different mass never share a curve:
 * camera travels long and settles softly, panels are heavy, rows snap,
 * type rises with a hard stop, digits are mechanical.
 */
export const ease = {
  camera: Easing.bezier(0.7, 0, 0.12, 1),
  cameraOut: Easing.bezier(0.05, 0.7, 0.1, 1),
  cameraIn: Easing.bezier(0.6, 0, 0.9, 0.4),
  heavy: Easing.bezier(0.45, 0, 0.1, 1),
  panelOvershoot: Easing.bezier(0.3, 0, 0.15, 1.12),
  snap: Easing.bezier(0.2, 0, 0, 1),
  rowSnap: Easing.bezier(0.1, 0.9, 0.2, 1),
  type: Easing.bezier(0.16, 1, 0.3, 1),
  typeIn: Easing.bezier(0.7, 0, 0.84, 0),
  digit: Easing.bezier(0.55, 0, 0.1, 1),
  linear: (t: number) => t,
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
} satisfies Record<string, EaseFn>;

export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Progress of frame f across [a, b], eased. */
export const p = (f: number, a: number, b: number, e: EaseFn = ease.inOut) => e(clamp01((f - a) / (b - a)));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Map frame f across [a, b] to [from, to] with easing. */
export const r = (f: number, a: number, b: number, from: number, to: number, e: EaseFn = ease.inOut) =>
  lerp(from, to, p(f, a, b, e));

export type Key = [frame: number, value: number, easeIn?: EaseFn];

/** Keyframe track: the ease on a key applies to the segment that arrives at it. */
export const track = (f: number, keys: Key[]): number => {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1, e] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (f <= f1) return lerp(v0, v1, (e ?? ease.inOut)(clamp01((f - f0) / (f1 - f0))));
  }
  return keys[keys.length - 1][1];
};

/** Rough velocity of a track (units/frame) — drives motion blur. */
export const velocity = (f: number, keys: Key[]) => track(f + 0.5, keys) - track(f - 0.5, keys);

export const inWindow = (f: number, a: number, b: number) => f >= a && f < b;

/** Zoom tracks interpolate in log space so a 37× → 1× pull reads as constant camera speed. */
export const trackLog = (f: number, keys: Key[]): number =>
  Math.exp(track(f, keys.map(([k, v, e]) => [k, Math.log(v), e] as Key)));
