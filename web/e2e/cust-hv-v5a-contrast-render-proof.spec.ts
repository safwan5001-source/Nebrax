import { expect, test } from '@playwright/test';
import {
  composite,
  gradientInterval,
  luminance,
  parseHex,
  passes,
  ratio,
  solidInterval,
  worstRatio,
  type Overlay,
  type Rgb,
} from '../src/modules/store-experience-builder/presentation/contrast-engine';

/**
 * CUST-HV V5a — the Implementation Evidence Gate for the contrast engine
 * (V0 §3.2.1 / §4.5 / §19.0, AMEND-20): proof against REAL RENDERED PIXELS.
 *
 * Chromium paints a CSS gradient, with and without an alpha overlay, to a
 * screenshot; every pixel's WCAG luminance is measured; and the engine must
 *   (1) never claim more contrast than the worst pixel actually drawn, and
 *   (2) not be uselessly pessimistic (≤ 8 % below the measured worst, which
 *       includes its measured one-level rounding allowance), and
 *   (3) reproduce the documented counter-examples (gradient-interior, overlay).
 * Each case is rendered as a horizontal AND a diagonal gradient: the engine
 * ignores direction (text position is unknown), so both must be covered.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PNG } = require('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Uint8Array } } };
};

interface Spec {
  name: string;
  from: string;
  to: string;
  overlay?: { color: string; alpha: number };
  fg: string;
}

const CASES: Spec[] = [
  { name: 'AMEND counter-example, black text', from: '#d1456a', to: '#1e8b9a', fg: '#000000' },
  { name: 'dark to light, white text (crosses)', from: '#101820', to: '#e8e8e8', fg: '#ffffff' },
  { name: 'two darks, white text', from: '#0b3d2e', to: '#1c2a6b', fg: '#ffffff' },
  { name: 'light gradient under brand overlay', from: '#f5f5f5', to: '#dcdcdc', overlay: { color: '#12372a', alpha: 0.35 }, fg: '#ffffff' },
  { name: 'counter-example under 50% black overlay', from: '#d1456a', to: '#1e8b9a', overlay: { color: '#000000', alpha: 0.5 }, fg: '#ffffff' },
  { name: '40% white over black (AMEND-18), black text', from: '#000000', to: '#000000', overlay: { color: '#ffffff', alpha: 0.4 }, fg: '#000000' },
  { name: 'mid grey pair, white text', from: '#777777', to: '#999999', fg: '#ffffff' },
];

const W = 400;
const H = 120;

async function render(page: import('@playwright/test').Page, c: Spec, direction: string) {
  const overlay = c.overlay
    ? `<div style="position:absolute;inset:0;background:${c.overlay.color};opacity:${c.overlay.alpha}"></div>`
    : '';
  await page.setContent(
    `<html><body style="margin:0;background:#fff"><div id="box" style="position:relative;width:${W}px;height:${H}px;background:linear-gradient(${direction}, ${c.from}, ${c.to})">${overlay}</div></body></html>`,
  );
  const png = PNG.sync.read(await page.locator('#box').screenshot());
  return png;
}

function measuredWorst(png: { width: number; height: number; data: Uint8Array }, fgL: number) {
  let worst = Number.POSITIVE_INFINITY;
  let minL = 1;
  let maxL = 0;
  for (let i = 0; i < png.width * png.height; i += 1) {
    const l = luminance(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]);
    minL = Math.min(minL, l);
    maxL = Math.max(maxL, l);
    worst = Math.min(worst, ratio(fgL, l));
  }
  return { worst, minL, maxL };
}

for (const c of CASES) {
  for (const direction of ['to right', 'to bottom right']) {
    test(`${c.name} — ${direction}`, async ({ page }) => {
      const png = await render(page, c, direction);
      const from = parseHex(c.from)!;
      const to = parseHex(c.to)!;
      const overlay: Overlay | null = c.overlay ? { rgb: parseHex(c.overlay.color)!, alpha: c.overlay.alpha } : null;
      const fg = parseHex(c.fg)!;
      const fgL = luminance(fg[0], fg[1], fg[2]);
      const iv = from.every((v, i) => v === to[i]) ? solidInterval(from, overlay) : gradientInterval(from, to, overlay);
      const engine = worstRatio(fgL, iv);
      const real = measuredWorst(png, fgL);

      // The drawn luminance range sits inside the engine's proven range.
      expect(real.minL).toBeGreaterThanOrEqual(iv.min - 1e-9);
      expect(real.maxL).toBeLessThanOrEqual(iv.max + 1e-9);
      // (1) never overstates what is on screen
      expect(engine).toBeLessThanOrEqual(real.worst + 1e-9);
      // (2) and is not uselessly pessimistic (relative, in the decision range)
      if (real.worst >= 2 && real.worst <= 8) expect((real.worst - engine) / real.worst).toBeLessThan(0.08);
      // verdicts agree wherever the real result is clearly on one side
      if (real.worst >= 4.5 * 1.08) expect(passes(engine)).toBe(true);
      if (real.worst < 4.5) expect(passes(engine)).toBe(false);
    });
  }
}

test('the counter-example: both stops pass, the rendered interior does not, and the engine says so', async ({ page }) => {
  const c = CASES[0];
  const png = await render(page, c, 'to right');
  const from = parseHex(c.from)!;
  const to = parseHex(c.to)!;
  const endpoints = Math.min(ratio(0, luminance(from[0], from[1], from[2])), ratio(0, luminance(to[0], to[1], to[2])));
  const real = measuredWorst(png, 0);
  expect(endpoints).toBeGreaterThan(4.5);
  expect(real.worst).toBeLessThan(4.5);
  expect(passes(worstRatio(0, gradientInterval(from, to)))).toBe(false);
});

test('overlay compositing: the browser draws encoded-space blending (≈3.66:1), not the linear-light ≈9:1', async ({ page }) => {
  const c = CASES[5];
  const png = await render(page, c, 'to right');
  const real = measuredWorst(png, 0);
  expect(real.worst).toBeGreaterThan(3.6);
  expect(real.worst).toBeLessThan(3.72);
  const predicted = composite([255, 255, 255] as Rgb, 0.4, [0, 0, 0] as Rgb);
  expect(Math.abs(predicted[0] - 102)).toBeLessThan(1e-9); // encoded 40 % white over black
  const engine = worstRatio(0, solidInterval([0, 0, 0], { rgb: [255, 255, 255], alpha: 0.4 }));
  expect(engine).toBeLessThanOrEqual(real.worst);
  expect(engine).toBeGreaterThan(3.5);
});

test('an image-like region: a half-dark half-light patch is judged by its extremes, not its average', async ({ page }) => {
  await page.setContent(
    `<html><body style="margin:0"><div id="box" style="width:${W}px;height:${H}px;background:linear-gradient(to right,#0a0a0a 50%,#f5f5f5 50%)"></div></body></html>`,
  );
  const png = PNG.sync.read(await page.locator('#box').screenshot());
  let sum = 0;
  for (let i = 0; i < png.width * png.height; i += 1) sum += luminance(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]);
  const average = sum / (png.width * png.height);
  // an average-luminance check sees a mid-tone and a healthy-looking ratio …
  const averageRatio = ratio(1, average);
  expect(averageRatio).toBeGreaterThan(1.8);
  // … but the light half makes it unreadable, and the extremes say so.
  const real = measuredWorst(png, 1);
  expect(real.worst).toBeLessThan(1.2);
  expect(averageRatio).toBeGreaterThan(real.worst * 1.5);
});
