import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resolveSectionDesign } from '../src/modules/store-experience-builder/presentation/section-design-resolve';
import type { SectionDesign } from '../src/modules/store-experience-builder/presentation/section-design';

/**
 * CUST-HV V5e-3 — section-edge separators and the one-time reveal, proved on the REAL compiled
 * storefront stylesheet (Tailwind v4, native cascade layers) in Chromium, driven by the real
 * resolver output (the web twin, byte-identical to the storefront's). A separator must paint on the
 * frame, reserve its height as padding so nothing is covered, keep every focus ring unclipped, and
 * mirror under RTL; the reveal must hide nothing unless the observer opted a section in.
 */
let css = '';
test.beforeAll(() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'sf-css-')), 'storefront.css');
  execFileSync('node', [path.resolve(__dirname, 'support/compile-storefront-css.mjs'), out], { stdio: 'pipe' });
  css = readFileSync(out, 'utf8');
});

const ctx = (dir: 'ltr' | 'rtl') => ({ primaryColor: '#12372a', accentColor: null, dir });

function frame(design: SectionDesign, dir: 'ltr' | 'rtl' = 'ltr', extraAttrs = '') {
  const resolved = resolveSectionDesign('benefits', design, ctx(dir))!;
  const style = Object.entries(resolved.style)
    .map(([k, v]) => `${k}:${v.replace(/"/g, '&quot;')}`)
    .join(';');
  const sd = resolved.attrs['data-sd'];
  return `<div id="f" data-sd="${sd}" data-design-type="benefits" ${extraAttrs} style="${style}">
    <section id="root"><a id="edge" href="#" style="display:block;outline:2px solid #1d4ed8;outline-offset:2px">Edge link</a><p>Content</p></section>
  </div>`;
}

async function mount(page: Page, body: string, dir: 'ltr' | 'rtl' = 'ltr') {
  await page.setContent(
    `<!doctype html><html lang="en" dir="${dir}"><head><style>${css}</style></head><body><div style="padding:24px;width:760px">${body}</div></body></html>`,
  );
}

const frameStyle = (page: Page, props: string[]) =>
  page.locator('#f').evaluate(
    (el, ps) => {
      const cs = getComputedStyle(el) as unknown as Record<string, string>;
      return Object.fromEntries(ps.map((p) => [p, cs[p]]));
    },
    props,
  );

test('a bottom wave paints on the frame (data-URI layer), reserves its height as padding and keeps the content clear', async ({ page }) => {
  await mount(page, frame({ separator: { bottom: 'wave', height: 'lg' }, spacing: { bottom: 'md' } }));
  const s = await frameStyle(page, ['backgroundImage', 'backgroundPosition', 'backgroundSize', 'paddingBottom', 'paddingTop']);
  expect(s.backgroundImage).toContain('data:image/svg+xml');
  expect(s.backgroundPosition).toBe('50% 100%'); // anchored on the bottom edge
  expect(s.backgroundSize).toContain('64px'); // 4rem
  // reserved: the designed bottom spacing PLUS the separator's own height (md ≈ 20–32 px, so ≥ 4rem + that)
  expect(parseFloat(s.paddingBottom)).toBeGreaterThanOrEqual(64 + 20);
  expect(s.paddingTop).toBe('0px');
  // nothing of the content reaches into the reserved band
  const gap = await page.evaluate(() => {
    const f = document.getElementById('f')!.getBoundingClientRect();
    const root = document.getElementById('root')!.getBoundingClientRect();
    return f.bottom - root.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(64);
});

test('a top edge uses the top anchor; without a background the separator is the whole background', async ({ page }) => {
  await mount(page, frame({ separator: { top: 'band', height: 'md' } }));
  const s = await frameStyle(page, ['backgroundImage', 'backgroundPosition', 'paddingTop', 'backgroundColor']);
  expect(s.backgroundImage).toContain('linear-gradient');
  expect(s.backgroundPosition).toBe('50% 0%');
  expect(parseFloat(s.paddingTop)).toBeGreaterThanOrEqual(16); // 1rem band reserved
  expect(s.backgroundColor).toBe('rgba(0, 0, 0, 0)');
});

test('with a designed background the separator layers sit above it (one background value)', async ({ page }) => {
  await mount(page, frame({ background: { kind: 'solid', color: { hex: '#101820' } }, separator: { bottom: 'curve', color: { hex: '#fde68a' } } }));
  const s = await frameStyle(page, ['backgroundImage', 'backgroundColor']);
  expect(s.backgroundImage).toContain('data:image/svg+xml');
  expect(s.backgroundColor).toBe('rgb(16, 24, 32)');
  expect(decodeURIComponent(s.backgroundImage)).toContain("fill='#fde68a'");
});

test('the shape is mirrored under RTL and a top edge is flipped (inspected in the painted SVG)', async ({ page }) => {
  await mount(page, frame({ separator: { top: 'wave' } }, 'rtl'), 'rtl');
  const svg = decodeURIComponent((await frameStyle(page, ['backgroundImage'])).backgroundImage);
  expect(svg).toContain('translate(0 100) scale(1 -1)');
  expect(svg).toContain('translate(1200 0) scale(-1 1)');
});

test('focus rings at the content edge are never clipped (nothing clips the frame)', async ({ page }) => {
  await mount(page, frame({ separator: { top: 'wave', bottom: 'wave' }, radius: 'lg' }));
  const s = await frameStyle(page, ['overflow', 'clipPath']);
  expect(s.overflow).toBe('visible');
  expect(s.clipPath).toBe('none');
});

test('absent separator: the frame paints no background image and reserves nothing', async ({ page }) => {
  await mount(page, frame({ spacing: { top: 'md' } }));
  const s = await frameStyle(page, ['backgroundImage', 'paddingBottom']);
  expect(s.backgroundImage).toBe('none');
  expect(s.paddingBottom).toBe('0px');
});

test('reveal: visible with no attribute; hidden only while waiting; transitions in once; reduced motion never hides', async ({ page }) => {
  await mount(page, frame({ motion: { reveal: 'fade-up' } } as SectionDesign));
  // no JS opted it in ⇒ simply visible (no-JS safe, above-the-fold safe)
  expect((await frameStyle(page, ['opacity'])).opacity).toBe('1');

  await page.evaluate(() => document.getElementById('f')!.setAttribute('data-reveal', 'wait'));
  const waiting = await frameStyle(page, ['opacity', 'transform']);
  expect(waiting.opacity).toBe('0');
  expect(waiting.transform).not.toBe('none');

  await page.evaluate(() => document.getElementById('f')!.setAttribute('data-reveal', 'in'));
  await expect.poll(async () => (await frameStyle(page, ['opacity'])).opacity).toBe('1');
  expect((await frameStyle(page, ['transform'])).transform).toBe('none');
  const dur = (await frameStyle(page, ['transitionDuration'])).transitionDuration;
  expect(dur.split(',').every((d) => parseFloat(d) <= 0.4)).toBe(true); // ≤ 400 ms

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, frame({ motion: { reveal: 'fade-up' } } as SectionDesign));
  await page.evaluate(() => document.getElementById('f')!.setAttribute('data-reveal', 'wait'));
  expect((await frameStyle(page, ['opacity'])).opacity).toBe('1');
});
