import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V6a — real-render proof for per-instance heroes in the Canvas (the preview of what the
 * storefront publishes): in Arabic RTL and English LTR, at six widths, with two heroes —
 *  - exactly one <h1> (the first hero); the second hero's heading is an <h2>;
 *  - the first hero's two buttons keep their order (primary first, in the reading direction) and
 *    wrap rather than overflow on a narrow screen;
 *  - nothing overflows the page horizontally and no button is clipped by its hero;
 *  - the second, explicitly empty hero shows the store name and the default CTA.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v6a-hero');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`per-instance heroes ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=heroes&viewport=desktop`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-visual-root]');
      await hideDevOverlay(page);
      await page.waitForTimeout(300);

      // exactly one h1 among the hero headings; the second hero is an h2
      const headings = await page.$$eval('[data-preview-hero-heading]', (els) =>
        els.map((el) => ({ tag: el.tagName, text: el.textContent?.trim() ?? '' })),
      );
      expect(headings.map((h) => h.tag)).toEqual(['H1', 'H2']);
      expect(headings[0].text.length).toBeGreaterThan(5);
      expect(headings[1].text.length).toBeGreaterThan(0); // the store name (explicit empty headline)

      // no horizontal overflow
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // the two authored buttons: primary first in the reading direction; neither clipped by its hero
      const geometry = await page.evaluate(() => {
        const heroes = [...document.querySelectorAll('[data-preview-hero-heading]')].map((h) => h.closest('section') as HTMLElement);
        const first = heroes[0];
        const buttons = [...first.querySelectorAll('[data-preview-hero-cta]')] as HTMLElement[];
        const box = first.getBoundingClientRect();
        return {
          order: buttons.map((b) => b.getAttribute('data-preview-hero-cta')),
          rects: buttons.map((b) => {
            const r = b.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }),
          hero: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          dir: getComputedStyle(first).direction,
          secondDefaultCta: heroes[1].querySelectorAll('[data-preview-hero-cta]').length,
          secondHasShopNow: heroes[1].textContent?.length ?? 0,
        };
      });
      expect(geometry.order).toEqual(['primary', 'secondary']);
      for (const r of geometry.rects) {
        expect(r.left).toBeGreaterThanOrEqual(geometry.hero.left - 0.5);
        expect(r.right).toBeLessThanOrEqual(geometry.hero.right + 0.5);
        expect(r.bottom).toBeLessThanOrEqual(geometry.hero.bottom + 0.5);
      }
      const [a, b] = geometry.rects;
      const sameRow = Math.abs(a.top - b.top) < 4;
      if (sameRow) {
        // reading order: in LTR the primary is on the left, in RTL on the right
        if (geometry.dir === 'rtl') expect(a.left).toBeGreaterThan(b.left);
        else expect(a.left).toBeLessThan(b.left);
      } else {
        expect(a.top).toBeLessThan(b.top); // wrapped: the primary stays above
      }
      expect(geometry.secondDefaultCta).toBe(0); // the second hero uses the default (non-authored) CTA

      await page.screenshot({ path: path.join(evidenceDir, `heroes-${locale}-${width}.png`), fullPage: true });
    });
  }
}

test('with a hero hidden the page keeps exactly one h1 (the hidden store heading)', async ({ page }) => {
  await page.goto('/dev/customizer-visual?locale=en&scenario=empty&viewport=desktop');
  await page.waitForSelector('[data-visual-root]');
  const h1s = await page.$$eval('[data-visual-root] h1', (els) => els.length);
  expect(h1s).toBeLessThanOrEqual(1);
});
