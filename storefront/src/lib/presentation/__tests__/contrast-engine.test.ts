import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type LuminanceInterval,
  type Overlay,
  type Rgb,
  autoForeground,
  channelBoundsInterval,
  composite,
  gradientInterval,
  luminance,
  parseHex,
  passes,
  ratio,
  solidInterval,
  worstRatio,
  worstRatioForHex,
} from "../contrast-engine";

interface Case {
  name: string;
  kind: "solid" | "gradient" | "bounds";
  color?: string;
  from?: string;
  to?: string;
  min?: Rgb;
  max?: Rgb;
  overlay?: [string, number];
  fg: string;
  expected: { min: number; max: number; worst: number; passesNormal: boolean; passesLarge: boolean; auto: string };
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../tests/Fixtures/presentation/contrast.json"), "utf8"),
) as { cases: Case[] };

function overlayOf(c: Case): Overlay | null {
  return c.overlay ? { rgb: parseHex(c.overlay[0])!, alpha: c.overlay[1] } : null;
}
function intervalOf(c: Case): LuminanceInterval {
  const ov = overlayOf(c);
  if (c.kind === "solid") return solidInterval(parseHex(c.color!)!, ov);
  if (c.kind === "gradient") return gradientInterval(parseHex(c.from!)!, parseHex(c.to!)!, ov);
  return channelBoundsInterval(c.min!, c.max!, ov);
}

describe("contrast engine — fixture parity with the PHP authority (V5a)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const iv = intervalOf(c);
      expect(iv.min).toBeCloseTo(c.expected.min, 6);
      expect(iv.max).toBeCloseTo(c.expected.max, 6);
      const worst = worstRatioForHex(c.fg, iv);
      expect(worst).toBeCloseTo(c.expected.worst, 4);
      expect(passes(worst, 4.5)).toBe(c.expected.passesNormal);
      expect(passes(worst, 3)).toBe(c.expected.passesLarge);
      expect(autoForeground(iv)).toBe(c.expected.auto);
    });
  }
});

/** Dense brute force over the real interpolation — the thing the engine must bound. */
function bruteWorst(from: Rgb, to: Rgb, fgL: number, overlay: Overlay | null, steps = 4096): number {
  const a = overlay ? composite(overlay.rgb, overlay.alpha, from) : from;
  const b = overlay ? composite(overlay.rgb, overlay.alpha, to) : to;
  let worst = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const l = luminance(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    worst = Math.min(worst, ratio(fgL, l));
  }
  return worst;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("contrast engine — soundness against brute force (V5a)", () => {
  it("never overstates compliance (conservative) and stays tight, over 400 random gradients, with and without overlays", () => {
    const next = rng(20261007);
    const color = (): Rgb => [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
    let worstOverstatement = 0;
    let loosest = 0;
    for (let i = 0; i < 400; i += 1) {
      const from = color();
      const to = color();
      const overlay: Overlay | null = i % 2 ? { rgb: color(), alpha: Math.round(next() * 18) * 0.05 } : null;
      const fg: Rgb = i % 4 < 2 ? [255, 255, 255] : [0, 0, 0];
      const fgL = luminance(fg[0], fg[1], fg[2]);
      const engine = worstRatio(fgL, gradientInterval(from, to, overlay));
      const truth = bruteWorst(from, to, fgL, overlay);
      worstOverstatement = Math.max(worstOverstatement, engine - truth);
      if (truth >= 2 && truth <= 8) loosest = Math.max(loosest, (truth - engine) / truth);
    }
    // The engine must never claim more contrast than the real range provides…
    expect(worstOverstatement).toBeLessThanOrEqual(1e-9);
    // …and, where the decision actually happens (2:1–8:1), the proven slack stays within 7 % (that includes the measured one-level rounding allowance).
    expect(loosest).toBeLessThan(0.07);
  });

  it("catches the documented counter-example that an endpoints-only check wrongly passes", () => {
    const from = parseHex("#d1456a")!;
    const to = parseHex("#1e8b9a")!;
    const black = 0;
    const endpoints = Math.min(
      ratio(black, luminance(from[0], from[1], from[2])),
      ratio(black, luminance(to[0], to[1], to[2])),
    );
    expect(endpoints).toBeGreaterThan(4.5); // 4.77 / 5.21 — both stops "pass"
    const worst = worstRatio(black, gradientInterval(from, to));
    expect(worst).toBeLessThan(4.5); // the interior is ≈ 4.09
    expect(worst).toBeGreaterThan(3.9);
    expect(passes(worst)).toBe(false);
  });

  it("composites an overlay on encoded channels, not linear light (the AMEND-18 case)", () => {
    // 40 % white over black → encoded 102, luminance ≈ 0.133; black text ≈ 3.66:1.
    const iv = solidInterval([0, 0, 0], { rgb: [255, 255, 255], alpha: 0.4 });
    const worst = worstRatio(0, iv);
    expect(worst).toBeLessThan(3.66);
    expect(worst).toBeGreaterThan(3.5);
    // a linear-light blend would have claimed ≈ 9:1 — far more than the browser draws.
    expect(worst).toBeLessThan(5);
  });

  it("an image region is judged by its extremes, never its average", () => {
    // half near-black, half near-white: the average is mid-grey but white text lands on the light half.
    const iv = channelBoundsInterval([10, 10, 10], [245, 245, 245]);
    expect(worstRatio(1, iv)).toBeLessThan(1.2);
    expect(passes(worstRatio(1, iv))).toBe(false);
  });

  it("a foreground whose luminance lies inside the background range is exactly 1:1 worst case", () => {
    const iv = gradientInterval([0, 0, 0], [255, 255, 255]);
    expect(worstRatio(0.2, iv)).toBe(1);
  });

  it("unproven is non-compliant: an invalid colour never passes", () => {
    expect(worstRatioForHex("white", solidInterval([255, 255, 255]))).toBe(1);
    expect(passes(1)).toBe(false);
  });

  it("an automatic foreground exists for every opaque background (no colour is rejected)", () => {
    const next = rng(7);
    for (let i = 0; i < 500; i += 1) {
      const c: Rgb = [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
      const iv = solidInterval(c);
      const fg = autoForeground(iv);
      expect(worstRatioForHex(fg, iv)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
