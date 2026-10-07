import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V5e-2a — the Canvas wears the global tokens exactly as the storefront does (same
 * resolver, same stylesheet block): a populated page at the boldest step of every token,
 * AR RTL + EN LTR at six widths. Asserts the tokens are really applied (not merely present
 * as attributes) and that nothing overflows the page or collapses the layout.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v5e2a');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

for (const locale of ['ar', 'en'] as const) {
  for (const width of WIDTHS) {
    test(`global tokens ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=global&viewport=desktop`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-visual-root]');
      await hideDevOverlay(page);
      await page.waitForTimeout(300);

      const result = await page.evaluate(() => {
        const root = document.querySelector('.awj-store-preview') as HTMLElement;
        const cs = getComputedStyle(root);
        const failures: string[] = [];
        const gt = root.getAttribute('data-gt') ?? '';
        for (const token of ['hz', 'bz', 'hw', 'bw', 'lh', 'hs-underline', 'sbw', 'shd', 'mo-d', 'mo-e']) {
          if (!gt.split(' ').includes(token)) failures.push(`missing data-gt token ${token}`);
        }
        if (cs.fontWeight !== '500') failures.push(`body weight ${cs.fontWeight}`);
        // headings: scaled once, heavy, underlined section headings
        const heading = root.querySelector('[data-section-heading] h2, [data-section-heading] h1') as HTMLElement | null;
        if (!heading) failures.push('no section heading found');
        else {
          const h = getComputedStyle(heading);
          if (Math.abs(parseFloat(h.zoom) - 1.125) > 0.001) failures.push(`heading zoom ${h.zoom}`);
          if (h.fontWeight !== '800') failures.push(`heading weight ${h.fontWeight}`);
          // computed lengths are reported in the zoomed element's own space: 2px / 1.125
          if (parseFloat(h.borderBottomWidth) * parseFloat(h.zoom) < 1.9) failures.push(`section heading has no underline (${h.borderBottomWidth})`);
        }
        const bar = root.querySelector('[data-section-heading] [data-heading-bar]') as HTMLElement | null;
        if (bar && getComputedStyle(bar).display !== 'none') failures.push('underline style still shows the bar');
        // cards: pill-step radius, medium border, shadow
        const card = [...root.querySelectorAll('.rounded-store.border.bg-store-surface')].find(
          (el) => el.getBoundingClientRect().width > 0,
        ) as HTMLElement | undefined;
        if (!card) failures.push('no card found');
        else {
          const c = getComputedStyle(card);
          if (Math.abs(parseFloat(c.borderTopLeftRadius) - 28) > 1) failures.push(`card radius ${c.borderTopLeftRadius}`);
          if (parseFloat(c.borderTopWidth) !== 2) failures.push(`card border ${c.borderTopWidth}`);
          if (c.boxShadow === 'none') failures.push('card has no shadow');
        }
        // fonts (V5e-2c): headings use the serif pair, the body the Readex family — both resolved to the
        // real next/font faces (their hashed names carry the family name), not a fallback
        const bodyFont = cs.fontFamily;
        if (!/Readex/i.test(bodyFont)) failures.push(`body font ${bodyFont.slice(0, 80)}`);
        const h = root.querySelector('[data-section-heading] h2') as HTMLElement | null;
        if (h && !/Lora/i.test(getComputedStyle(h).fontFamily)) failures.push(`heading font ${getComputedStyle(h).fontFamily.slice(0, 80)}`);
        for (const token of ['hf']) {
          if (!gt.split(' ').includes(token)) failures.push(`missing data-gt token ${token}`);
        }
        // buttons (V5e-2b): the banner CTA is a soft pill, large, heavy, uppercase; its label is readable
        for (const token of ['b-sz', 'b-rad', 'b-fw', 'b-up', 'b-pri', 'b-hv-lift']) {
          if (!gt.split(' ').includes(token)) failures.push(`missing data-gt token ${token}`);
        }
        const cta = root.querySelector('.rounded-store.bg-store-primary.font-bold') as HTMLElement | null;
        if (!cta) failures.push('no solid CTA found');
        else {
          const b = getComputedStyle(cta);
          if (parseFloat(b.borderTopLeftRadius) < 1000) failures.push(`button radius ${b.borderTopLeftRadius}`);
          if (b.fontWeight !== '800') failures.push(`button weight ${b.fontWeight}`);
          if (b.textTransform !== 'uppercase') failures.push(`button case ${b.textTransform}`);
          if (parseFloat(b.paddingTop) < 13) failures.push(`button size ${b.paddingTop}`);
          const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
          const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
          const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
          const fill = rgb(b.backgroundColor);
          const label = rgb(b.color);
          const ratio = (Math.max(lum(fill), lum(label)) + 0.05) / (Math.min(lum(fill), lum(label)) + 0.05);
          if (b.backgroundColor === 'rgb(18, 55, 42)') failures.push('soft button still has the solid brand fill');
          if (ratio < 4.5) failures.push(`button label contrast ${ratio.toFixed(2)}`);
        }
        // layout: the container is narrow
        const container = root.querySelector('.max-w-store') as HTMLElement | null;
        if (container) {
          const w = container.getBoundingClientRect().width;
          if (w > 1024 + 1) failures.push(`content width ${w}`);
        }
        // motion: a transitioning element uses the slow duration
        const moving = root.querySelector('[class*="transition"]') as HTMLElement | null;
        if (moving && getComputedStyle(moving).transitionDuration.split(',')[0].trim() !== '0.5s') {
          failures.push(`transition ${getComputedStyle(moving).transitionDuration}`);
        }
        return { failures, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });

      expect(result.failures, result.failures.join('\n')).toEqual([]);
      expect(result.overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(evidenceDir, `global-${locale}-${width}.png`), fullPage: true });
    });
  }
}

test('without any global token the Canvas carries no data-gt and no --gt variable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dev/customizer-visual?locale=en&scenario=populated&viewport=desktop');
  await page.waitForSelector('[data-visual-root]');
  const state = await page.evaluate(() => {
    const root = document.querySelector('.awj-store-preview') as HTMLElement;
    return { gt: root.hasAttribute('data-gt'), style: root.getAttribute('style') ?? '' };
  });
  expect(state.gt).toBe(false);
  expect(state.style).not.toContain('--gt-');
});

test('catalogue fonts are loaded only when selected: the chosen faces load, the other six never do', async ({ page }) => {
  const loadedFamilies = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family);
    });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/dev/customizer-visual?locale=en&scenario=global&viewport=desktop');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-visual-root]');
  const chosen = await loadedFamilies();
  expect(chosen.some((family) => /Readex/i.test(family)), `loaded: ${chosen.join(', ')}`).toBe(true);
  expect(chosen.some((family) => /Lora/i.test(family)), `loaded: ${chosen.join(', ')}`).toBe(true);
  for (const unused of [/Rubik/i, /Plex/i, /El_Messiri|El Messiri/i, /Noto_Sans_Arabic|Noto Sans Arabic/i, /Tajawal/i]) {
    expect(chosen.some((family) => unused.test(family)), `${unused} should not load: ${chosen.join(', ')}`).toBe(false);
  }

  // without any font token the catalogue faces never load at all
  await page.goto('/dev/customizer-visual?locale=en&scenario=populated&viewport=desktop');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-visual-root]');
  const plain = await loadedFamilies();
  for (const unused of [/Readex/i, /Lora/i, /Rubik/i, /Plex/i, /El_Messiri|El Messiri/i, /Noto_Sans_Arabic|Noto Sans Arabic/i]) {
    expect(plain.some((family) => unused.test(family)), `${unused} should not load: ${plain.join(', ')}`).toBe(false);
  }
});
