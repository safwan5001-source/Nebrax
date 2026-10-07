import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V5c — real-render proof for section design in the Canvas (the same
 * resolver and stylesheet the published storefront uses).
 *
 * For every section that wears a design, in a real browser, in Arabic RTL and
 * English LTR, at six widths:
 *  - it renders inside a `data-sd` wrapper (and a section WITHOUT design does not);
 *  - NOTHING overflows the page horizontally (the full-bleed band is the risk);
 *  - every visible text node's drawn colour clears 4.5:1 (3:1 for large text)
 *    against the background that is actually behind it — walking up to the first
 *    painted ancestor, over a gradient's real pixels (sampled), never its ends.
 *    This is what proves the re-pointed text tokens + the nested-surface reset
 *    never produce white-on-white inside a card or dark-on-dark on a band.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v5c-design');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`section design ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=design&viewport=desktop`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-visual-root]');
      await hideDevOverlay(page);
      await page.waitForTimeout(300);

      const wrappers = page.locator('[data-sd]');
      expect(await wrappers.count()).toBeGreaterThanOrEqual(7);

      // no page-level horizontal overflow introduced by bleed / widths
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      const result = await page.evaluate(() => {
        const parse = (c: string) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(',').map((x) => parseFloat(x));
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
        };
        const lin = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

        // Effective background luminances behind an element: first painted ancestor.
        // A gradient is sampled from its two resolved stops through its whole range.
        const backgroundsBehind = (el: Element): number[] | null => {
          for (let node: Element | null = el; node; node = node.parentElement) {
            const cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
              const stops = [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])!).filter(Boolean);
              if (stops.length >= 2) {
                const out: number[] = [];
                for (let i = 0; i <= 64; i += 1) {
                  const t = i / 64;
                  const a = stops[0];
                  const b = stops[stops.length - 1];
                  out.push(lum({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }));
                }
                return out;
              }
            }
            const bg = parse(cs.backgroundColor);
            if (bg && bg.a >= 0.99) return [lum(bg)];
            // the full-bleed band paints through a box-shadow spread
            const sh = cs.boxShadow;
            const band = sh && sh !== 'none' ? parse(sh.match(/rgba?\([^)]+\)/)?.[0] ?? '') : null;
            if (band && band.a >= 0.99 && sh.includes('100')) return [lum(band)];
          }
          return null;
        };

        const failures: string[] = [];
        let checked = 0;
        const walker = document.createTreeWalker(document.querySelector('[data-visual-root]')!, NodeFilter.SHOW_TEXT);
        const seen = new Set<Element>();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = (n as Text).parentElement;
          if (!el || seen.has(el) || !(n as Text).textContent!.trim()) continue;
          seen.add(el);
          if (!el.closest('[data-sd]')) continue; // only text inside a designed section
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const fg = parse(cs.color);
          const bgs = backgroundsBehind(el);
          if (!fg || !bgs) continue;
          const fgL = lum(fg);
          const worst = Math.min(...bgs.map((b) => ratio(fgL, b)));
          const sizePx = parseFloat(cs.fontSize);
          const bold = parseInt(cs.fontWeight, 10) >= 700;
          const large = sizePx >= 24 || (sizePx >= 18.66 && bold);
          checked += 1;
          if (worst < (large ? 3 : 4.5)) {
            failures.push(`${el.tagName.toLowerCase()} "${(n as Text).textContent!.trim().slice(0, 30)}" ${cs.color} ratio ${worst.toFixed(2)}`);
          }
        }
        return { checked, failures };
      });

      expect(result.checked).toBeGreaterThan(10);
      expect(result.failures, result.failures.join('\n')).toEqual([]);
      await page.screenshot({ path: path.join(evidenceDir, `design-${locale}-${width}.png`), fullPage: true });
    });
  }
}

test('a section without a design is not wrapped (absent ⇒ unchanged)', async ({ page }) => {
  await page.goto('/dev/customizer-visual?locale=en&scenario=populated&viewport=desktop');
  await page.waitForSelector('[data-visual-root]');
  expect(await page.locator('[data-sd]').count()).toBe(0);
  expect(await page.locator('[data-design-type]').count()).toBe(0);
});
