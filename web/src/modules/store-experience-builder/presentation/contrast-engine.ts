/**
 * CUST-HV V5a — contrast engine (V0 §3.2.1 / §4.5, AMEND-20).
 *
 * V0 froze the *invariant*, not the algorithm: any informative text over a
 * merchant-controlled colour, gradient, overlay or image must meet the WCAG
 * threshold against what is **actually rendered** — never a region average,
 * never a gradient's two stops alone — and "unproven" is "non-compliant".
 * This file is the algorithm V5 selected and proved. Twin of
 * `storefront/src/lib/presentation/contrast-engine.ts` (byte-identical) and of
 * PHP `App\Support\Commerce\ContrastEngine` (the authority); all three run
 * `tests/Fixtures/presentation/contrast.json`.
 *
 * Model (everything on gamma-ENCODED sRGB channels, as browsers do):
 *  1. alpha compositing is linear on encoded channels (not on linear light);
 *  2. a CSS linear-gradient interpolates encoded channels, and an overlay over a
 *     gradient is a gradient between the two composited ends (both linear);
 *  3. gradient direction is ignored — the text position inside the section is
 *     unknown, so the WHOLE range is checked;
 *  4. WCAG luminance is a nonlinear function of the encoded channels, so the
 *     ends are not enough: dense samples, then widen the range by a PROVEN bound
 *     (luminance is Lipschitz, K = Σ wᵢ·slope(cᵢ)·|Δᵢ|; any point is ≤ δt/2 from a
 *     sample, so it deviates ≤ K·δt/2);
 *  5. browser rounding/dithering: one measured level times the LOCAL slope;
 *  6. image regions come in as per-channel encoded min/max over the pixels
 *     actually rendered (V6); luminance is monotone per channel ⇒ strict bounds;
 *  7. worst ratio over [Lmin, Lmax] against the foreground luminance Lf: if Lf
 *     lies inside the range the background crosses it ⇒ worst ratio is 1.
 */

export const TEXT_NORMAL = 4.5;
/** Large text (≥ 24 px or ≥ 18.66 px bold) and applicable non-text UI. */
export const TEXT_LARGE = 3;
export const GRADIENT_SAMPLES = 1024;
/** max d lin(c) / d c on c ∈ [0, 1] (at c = 1: 2.4 / 1.055). */
export const SLOPE = 2.4 / 1.055;
/**
 * one full 8-bit level. Measured on real Chromium pixels (see
 * e2e/cust-hv-v5a-contrast-render-proof.spec.ts): a drawn gradient deviates up
 * to 0.99 level from the ideal interpolation, so half a level is not enough.
 */
export const LEVEL_ERROR = 1 / 255;

const W_R = 0.2126;
const W_G = 0.7152;
const W_B = 0.0722;
const HEX = /^#([0-9a-fA-F]{6})$/;

export type Rgb = readonly [number, number, number];
export interface Overlay {
  rgb: Rgb;
  /** 0–1 */
  alpha: number;
}
export interface LuminanceInterval {
  min: number;
  max: number;
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** local d lin(c)/dc on c ∈ [0, 1]; increasing in c, so the upper end bounds a range. */
function slopeAt(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.03928
    ? 1 / 12.92
    : (2.4 / 1.055) * ((x + 0.055) / 1.055) ** 1.4;
}

/** 8-bit rounding slack for a colour range whose per-channel upper bound is `hi` (0–255). */
function roundSlack(hi: Rgb): number {
  return (
    W_R * slopeAt(hi[0] / 255 + LEVEL_ERROR) * LEVEL_ERROR +
    W_G * slopeAt(hi[1] / 255 + LEVEL_ERROR) * LEVEL_ERROR +
    W_B * slopeAt(hi[2] / 255 + LEVEL_ERROR) * LEVEL_ERROR
  );
}

function lin(channel: number): number {
  const c = Math.max(0, Math.min(255, channel)) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of encoded 0–255 channels (may be fractional). */
export function luminance(r: number, g: number, b: number): number {
  return W_R * lin(r) + W_G * lin(g) + W_B * lin(b);
}

export function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Alpha-composite `fg` over an opaque `bg`, on encoded channels. */
export function composite(
  fg: Rgb,
  alpha: number,
  bg: Rgb,
): [number, number, number] {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    a * fg[0] + (1 - a) * bg[0],
    a * fg[1] + (1 - a) * bg[1],
    a * fg[2] + (1 - a) * bg[2],
  ];
}

function clampInterval(min: number, max: number): LuminanceInterval {
  return { min: Math.max(0, min), max: Math.min(1, max) };
}

export function solidInterval(
  color: Rgb,
  overlay: Overlay | null = null,
): LuminanceInterval {
  const c =
    overlay === null ? color : composite(overlay.rgb, overlay.alpha, color);
  const l = luminance(c[0], c[1], c[2]);
  const slack = overlay === null ? 0 : roundSlack(c);
  return clampInterval(l - slack, l + slack);
}

export function gradientInterval(
  from: Rgb,
  to: Rgb,
  overlay: Overlay | null = null,
): LuminanceInterval {
  const a =
    overlay === null ? from : composite(overlay.rgb, overlay.alpha, from);
  const b = overlay === null ? to : composite(overlay.rgb, overlay.alpha, to);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= GRADIENT_SAMPLES; i += 1) {
    const t = i / GRADIENT_SAMPLES;
    const l = luminance(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    );
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  const hi: Rgb = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
  const k =
    (W_R * slopeAt(hi[0] / 255) * Math.abs(b[0] - a[0]) +
      W_G * slopeAt(hi[1] / 255) * Math.abs(b[1] - a[1]) +
      W_B * slopeAt(hi[2] / 255) * Math.abs(b[2] - a[2])) /
    255;
  const slack = k / (2 * GRADIENT_SAMPLES) + roundSlack(hi);
  return clampInterval(min - slack, max + slack);
}

export function channelBoundsInterval(
  minRgb: Rgb,
  maxRgb: Rgb,
  overlay: Overlay | null = null,
): LuminanceInterval {
  const lo =
    overlay === null ? minRgb : composite(overlay.rgb, overlay.alpha, minRgb);
  const hi =
    overlay === null ? maxRgb : composite(overlay.rgb, overlay.alpha, maxRgb);
  const slack = overlay === null ? 0 : roundSlack(hi);
  return clampInterval(
    luminance(lo[0], lo[1], lo[2]) - slack,
    luminance(hi[0], hi[1], hi[2]) + slack,
  );
}

export function worstRatio(
  fgLuminance: number,
  interval: LuminanceInterval,
): number {
  if (fgLuminance >= interval.max)
    return (fgLuminance + 0.05) / (interval.max + 0.05);
  if (fgLuminance <= interval.min)
    return (interval.min + 0.05) / (fgLuminance + 0.05);
  return 1;
}

/** Invalid colour ⇒ 1 (unproven = non-compliant). */
export function worstRatioForHex(
  foreground: string,
  interval: LuminanceInterval,
): number {
  const rgb = parseHex(foreground);
  if (!rgb) return 1;
  return worstRatio(luminance(rgb[0], rgb[1], rgb[2]), interval);
}

/** Only an established ratio passes — never "no violation found". */
export function passes(
  worst: number,
  threshold: number = TEXT_NORMAL,
): boolean {
  return worst >= threshold;
}

export function autoForeground(
  interval: LuminanceInterval,
): "#ffffff" | "#000000" {
  return worstRatio(1, interval) >= worstRatio(0, interval)
    ? "#ffffff"
    : "#000000";
}
