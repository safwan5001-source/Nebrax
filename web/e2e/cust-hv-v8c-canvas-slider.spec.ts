import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V8c — the Canvas draws the slider from the same document, the same per-slide decision and the same stylesheet block as the
 * storefront: the active slide is whole and inside the frame, the others are inert and parked, a proven picture carries the proven copy
 * colour, an unproven one is withheld for the brand surface, the controls sit on the logical edges (mirrored under RTL), the copy is sized
 * for the SIMULATED device (not the host window's width), and nothing overflows. The media endpoints are mocked: picture A dark with proven
 * bounds, picture B with none, picture C light with proven bounds. AR RTL + EN LTR, three simulated devices.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v8c');
const A = '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e';
const B = '1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f';
const C = '2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70';
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${fill}"/></svg>`;

async function mockMedia(page: Page) {
  await page.route('https://signed.example/**', (route) => {
    const url = route.request().url();
    const fill = url.includes('light') ? '#eef2f5' : '#22303d';
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(fill) });
  });
  const mock = (id: string, file: string, contrast: { min: number[]; max: number[] } | null) =>
    Promise.all([
      page.route(`**/commerce/workspace/storefront-media/${id}/derivatives/status`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                media_id: id,
                usage_key: 'u',
                state: 'ready',
                files: [{ width: 1600, format: 'jpg', state: 'ready', url: `https://signed.example/${file}`, rendered_width: 1600, rendered_height: 900 }],
                ...(contrast ? { contrast } : {}),
              },
            ],
          }),
        }),
      ),
      page.route(`**/commerce/workspace/storefront-media/${id}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { id, name: file, mime: 'image/jpeg', size: 1, width: 1600, height: 900, variants_state: 'ready', thumbnail_url: `https://signed.example/${file}`, preview_url: `https://signed.example/${file}` },
          }),
        }),
      ),
    ]);
  await mock(A, 'dark.svg', { min: [30, 40, 55], max: [50, 62, 80] });
  await mock(B, 'dark2.svg', null);
  await mock(C, 'light.svg', { min: [220, 228, 235], max: [245, 248, 250] });
}

const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => { const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a]; return (lum(hi) + 0.05) / (lum(lo) + 0.05); };
const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

// The real builder shows the Canvas inside a fixed-width device frame inside a larger window; the dev page has no frame, so
// `framed` narrows the preview root to the device's width while the host window stays at 1440 — the case the `data-vp` rules exist for.
const DEVICE_WIDTH = { desktop: 1280, tablet: 768, mobile: 390 } as const;

for (const locale of ['ar', 'en'] as const) {
  for (const viewport of ['desktop', 'tablet', 'mobile'] as const) {
    test(`canvas slider ${locale} ${viewport} (device frame inside a 1440 window)`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await mockMedia(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      // the page's own horizontal overflow without a slider: the baseline a slider must not add to
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=populated&viewport=${viewport}`);
      await page.waitForSelector('[data-visual-root]');
      const baseline = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=slider&viewport=${viewport}`);
      await page.waitForSelector('[data-visual-root]');
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}.awj-store-preview{max-width:${DEVICE_WIDTH[viewport]}px;margin-inline:auto}` });
      const rtl = locale === 'ar';
      const side = (x: number) => (rtl ? -x : x);
      await page.waitForSelector('[data-slider] img');
      await page.waitForTimeout(500);

      const snap = () => page.evaluate(() => {
        const frame = (document.querySelector('.awj-store-preview') as HTMLElement).getBoundingClientRect();
        const root = document.querySelector('[data-slider]') as HTMLElement;
        const rr = root.getBoundingClientRect();
        const rect = (e: Element | null) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2 }; };
        const slides = [...root.querySelectorAll('[data-slider-slide]')].map((s) => {
          const cs = getComputedStyle(s);
          const h = s.querySelector('h2');
          const cta = s.querySelector('[data-slider-cta]');
          return {
            active: s.hasAttribute('data-active'), inert: s.hasAttribute('inert'), surface: (s as HTMLElement).dataset.surface, rect: rect(s), bg: cs.backgroundColor, minH: parseFloat(cs.minHeight),
            img: !!s.querySelector('img'), imgLoaded: (() => { const i = s.querySelector('img'); return !!i && i.complete && i.naturalWidth > 0; })(),
            h: rect(h), hColor: h ? getComputedStyle(h).color : null, hSize: h ? parseFloat(getComputedStyle(h).fontSize) : null,
            copy: rect(s.querySelector('[data-slider-copy]')), copyPad: (() => { const c = s.querySelector('[data-slider-copy]'); return c ? parseFloat(getComputedStyle(c).paddingInlineStart) : null; })(),
            ctaBg: cta ? getComputedStyle(cta).backgroundColor : null, ctaColor: cta ? getComputedStyle(cta).color : null, ctaH: cta ? cta.getBoundingClientRect().height : null,
          };
        });
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          frame: { l: frame.left, r: frame.right }, root: { l: rr.left, r: rr.right, w: rr.width, cx: (rr.left + rr.right) / 2 }, dir: root.getAttribute('dir'), vp: root.getAttribute('data-vp'),
          slides, prev: rect(root.querySelector('[data-slider-arrow="previous"]')), next: rect(root.querySelector('[data-slider-arrow="next"]')),
          dots: [...root.querySelectorAll('[data-slider-dots] button')].map((d) => ({ ...rect(d), current: d.getAttribute('aria-current') === 'true' })),
        };
      });

      let m = await snap();
      expect(m.overflow, 'the slider adds no horizontal overflow').toBeLessThanOrEqual(baseline);
      expect(m.dir).toBe(rtl ? 'rtl' : 'ltr');
      expect(m.vp).toBe(viewport);
      expect(m.root.l).toBeGreaterThanOrEqual(m.frame.l - 1);
      expect(m.root.r).toBeLessThanOrEqual(m.frame.r + 1);
      const s0 = m.slides[0];
      expect(s0.active).toBe(true);
      expect(s0.rect!.l).toBeGreaterThanOrEqual(m.root.l - 1);
      expect(s0.rect!.r).toBeLessThanOrEqual(m.root.r + 1);
      expect(s0.surface).toBe('picture');
      expect(s0.imgLoaded, 'the proven picture loads').toBe(true);
      // proven dark picture → automatic white copy, and the button label clears 4.5 against its fill
      expect(rgb(s0.hColor!)).toEqual([255, 255, 255]);
      expect(ratio(rgb(s0.ctaColor!), rgb(s0.ctaBg!))).toBeGreaterThanOrEqual(4.5);
      // the other slides are inert and parked outside the slider
      for (const x of m.slides.slice(1)) {
        expect(x.inert).toBe(true);
        expect(x.rect!.l >= m.root.r - 1 || x.rect!.r <= m.root.l + 1).toBe(true);
      }
      // the slide that comes next waits on the inline-end side
      expect(side(m.slides[1].rect!.cx - m.root.cx)).toBeGreaterThan(0);
      // arrows on the logical edges, 44 px, dots present
      expect(side(m.prev!.cx - m.root.cx)).toBeLessThan(0);
      expect(side(m.next!.cx - m.root.cx)).toBeGreaterThan(0);
      expect(m.prev!.w).toBeGreaterThanOrEqual(43.5);
      expect(m.dots).toHaveLength(3);
      // copy is sized for the SIMULATED device, not the host window
      const expectedH = viewport === 'mobile' ? 20 : viewport === 'tablet' ? 24 : 36;
      const expectedPad = viewport === 'mobile' ? 56 : viewport === 'tablet' ? 72 : 80;
      expect(s0.hSize).toBe(expectedH);
      expect(s0.copyPad).toBe(expectedPad);
      const expectedMinH = (viewport === 'mobile' ? 16 : viewport === 'tablet' ? 17.25 : 28.8) * 16;
      expect(Math.abs(s0.minH - expectedMinH)).toBeLessThanOrEqual(1);
      // the copy never leaves the simulated device's frame
      expect(s0.copy!.r).toBeLessThanOrEqual(m.root.r + 1);
      expect(s0.copy!.l).toBeGreaterThanOrEqual(m.root.l - 1);
      expect(m.root.w).toBeLessThanOrEqual(DEVICE_WIDTH[viewport] + 1);

      await page.screenshot({ path: path.join(evidenceDir, `slider-${locale}-${viewport}-1.png`) });

      // browse: the unproven slide withholds its picture for the brand surface, at ≥ 4.5
      await page.click('[data-slider-arrow="next"]');
      await page.waitForTimeout(450);
      m = await snap();
      const s1 = m.slides[1];
      expect(s1.active).toBe(true);
      expect(s1.surface).toBe('brand');
      expect(s1.img).toBe(false);
      expect(ratio(rgb(s1.hColor!), rgb(s1.bg))).toBeGreaterThanOrEqual(4.5);
      expect(s1.rect!.l).toBeGreaterThanOrEqual(m.root.l - 1);
      expect(s1.rect!.r).toBeLessThanOrEqual(m.root.r + 1);
      expect(m.dots[1].current).toBe(true);

      // the light picture proves BLACK copy
      await page.click('[data-slider-arrow="next"]');
      await page.waitForTimeout(450);
      m = await snap();
      const s2 = m.slides[2];
      expect(s2.active).toBe(true);
      expect(s2.surface).toBe('picture');
      expect(rgb(s2.hColor!)).toEqual([0, 0, 0]);
      expect(s2.imgLoaded).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `slider-${locale}-${viewport}-3.png`) });
    });
  }
}
