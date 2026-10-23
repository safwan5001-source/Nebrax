import { expect, test } from '@playwright/test';

/**
 * Typography Library Expansion — the main (global) font selector value reaches the real Canvas:
 * the wrapper's computed font-family and the loaded `next/font` face change per catalogue key, and
 * descendants (nav, cards, buttons, headings) inherit it; an explicit body/heading family still wins.
 * AR RTL + EN LTR, desktop + mobile. Runs against the local dev fixture (no backend).
 */
const FONTS = [
  { key: 'almarai', family: 'Almarai' },
  { key: 'alexandria', family: 'Alexandria' },
  { key: 'noto-kufi', family: 'Noto Kufi Arabic' },
  { key: 'reem-kufi', family: 'Reem Kufi' },
  { key: 'thmanyah-sans', family: 'thmanyahSans' },
  { key: 'thmanyah-serif-display', family: 'thmanyahSerifDisplay' },
  { key: 'thmanyah-serif-text', family: 'thmanyahSerifText' },
] as const;

for (const locale of ['ar', 'en'] as const) {
  for (const viewport of ['desktop', 'mobile'] as const) {
    for (const font of FONTS) {
      test(`global font ${font.key} ${locale} ${viewport}`, async ({ page }) => {
        await page.setViewportSize(viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
        await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=populated&viewport=${viewport}&fontPreset=${font.key}`);
        await page.waitForSelector('[data-visual-root]');
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
        await page.waitForTimeout(400);
        const result = await page.evaluate(async () => {
          const root = document.querySelector('.awj-store-preview') as HTMLElement;
          await document.fonts.ready;
          const primary = (el: Element | null) => (el ? getComputedStyle(el).fontFamily : null);
          const button = root.querySelector('button, a[class*="button"], [role="button"]');
          const heading = root.querySelector('h1, h2, h3');
          const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
          return { root: primary(root), button: primary(button), heading: primary(heading), loaded };
        });
        const needle = font.family.split(' ')[0];
        expect(result.root, 'wrapper').toContain(needle);
        // descendants inherit the wrapper's stack (unless a section design sets its own — none here)
        expect(result.button ?? result.root).toBe(result.root);
        expect(result.heading ?? result.root).toBe(result.root);
        expect(result.loaded.some((f) => f.includes(needle)), `loaded faces: ${result.loaded.join(',')}`).toBe(true);
      });
    }
  }
}

test('explicit body family still beats the global font; the default store keeps Cairo + Geist', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dev/customizer-visual?locale=en&scenario=global&fontPreset=thmanyah-sans');
  await page.waitForSelector('[data-visual-root]');
  const body = await page.evaluate(() => getComputedStyle(document.querySelector('.awj-store-preview') as HTMLElement).fontFamily);
  expect(body).toMatch(/readex/i); // the `global` scenario sets bodyFamily: readex
  await page.goto('/dev/customizer-visual?locale=en&scenario=populated');
  await page.waitForSelector('[data-visual-root]');
  const def = await page.evaluate(() => getComputedStyle(document.querySelector('.awj-store-preview') as HTMLElement).fontFamily);
  expect(def).toMatch(/geist/i);
  expect(def).toMatch(/cairo/i);
});
