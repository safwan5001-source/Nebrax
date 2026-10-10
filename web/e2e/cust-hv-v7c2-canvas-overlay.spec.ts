import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V7c-2 — the Canvas shows overlay-on-hero exactly as the storefront does (same resolver, same stylesheet block): the
 * header takes no height, the hero is flush at the top with its picture reaching both edges of the frame, the content starts
 * below the bands, text and icons are the proven colour at the top, and the header turns solid after a short scroll and again
 * transparent at the top. The media endpoints are mocked (a dark picture with proven contrast bounds). AR RTL + EN LTR, six widths.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v7c2');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const MEDIA_ID = '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e';
const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#2a3a4a"/></svg>';

async function mockMedia(page: Page) {
  await page.route('https://signed.example/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE }),
  );
  await page.route(`**/commerce/workspace/storefront-media/${MEDIA_ID}/derivatives/status`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            media_id: MEDIA_ID,
            usage_key: 'u',
            state: 'ready',
            files: [{ width: 1600, format: 'jpg', state: 'ready', url: 'https://signed.example/hero.svg', rendered_width: 1600, rendered_height: 900 }],
            contrast: { min: [30, 40, 55], max: [50, 62, 80] },
          },
        ],
      }),
    }),
  );
  await page.route(`**/commerce/workspace/storefront-media/${MEDIA_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { id: MEDIA_ID, name: 'hero.jpg', mime: 'image/jpeg', size: 1, width: 1600, height: 900, variants_state: 'ready', thumbnail_url: 'https://signed.example/hero.svg', preview_url: 'https://signed.example/hero.svg' },
      }),
    }),
  );
}

for (const locale of ['ar', 'en'] as const) {
  for (const width of WIDTHS) {
    test(`overlay-on-hero ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await mockMedia(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=overlay&viewport=desktop`);
      await page.waitForSelector('[data-visual-root]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForSelector('[data-ho~="on"]', { timeout: 15000 });
      await page.waitForTimeout(400);

      const m = await page.evaluate(() => {
        const root = document.querySelector('.awj-store-preview') as HTMLElement;
        const frame = root.getBoundingClientRect();
        const header = root.querySelector('header') as HTMLElement;
        const bands = [...header.children].filter((c) => c.matches('div, nav') && c.getClientRects().length > 0);
        const rects = bands.map((b) => b.getBoundingClientRect());
        const hero = root.querySelector('[data-ho]') as HTMLElement;
        const section = hero.querySelector('section') as HTMLElement;
        const backdrop = hero.querySelector('[data-sd-backdrop]') as HTMLElement;
        const h1 = root.querySelector('h1') as HTMLElement;
        const row = header.querySelector('[data-header-row]') as HTMLElement;
        return {
          hd: root.getAttribute('data-hd'),
          headerH: header.getBoundingClientRect().height,
          live: header.hasAttribute('data-header-live'),
          solid: header.hasAttribute('data-header-solid'),
          frame: { l: frame.left, r: frame.right, t: frame.top },
          blockT: Math.min(...rects.map((r) => r.top)),
          blockB: Math.max(...rects.map((r) => r.bottom)),
          hdBlock: parseFloat(root.style.getPropertyValue('--hd-block')),
          sectionT: section.getBoundingClientRect().top,
          sectionPad: parseFloat(getComputedStyle(section).paddingTop),
          backdrop: { l: backdrop.getBoundingClientRect().left, r: backdrop.getBoundingClientRect().right, t: backdrop.getBoundingClientRect().top },
          h1T: h1.getBoundingClientRect().top,
          rowBg: getComputedStyle(row).backgroundColor,
          wordmark: getComputedStyle(header.querySelector('[data-header-brand]') as HTMLElement).color,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(m.hd).toContain('hmo');
      expect(m.headerH).toBeLessThan(0.5);
      expect(m.live).toBe(true);
      expect(m.solid).toBe(false);
      expect(Math.abs(m.sectionT - m.blockT)).toBeLessThan(1);
      expect(Math.abs(m.backdrop.t - m.blockT)).toBeLessThan(1);
      expect(m.backdrop.l).toBeLessThanOrEqual(m.frame.l + 0.5);
      expect(m.backdrop.r).toBeGreaterThanOrEqual(m.frame.r - 0.5);
      expect(m.h1T).toBeGreaterThanOrEqual(m.blockB - 0.5);
      expect(Math.abs(m.hdBlock - (m.blockB - m.blockT))).toBeLessThan(1.5);
      expect(Math.abs(m.sectionPad - m.hdBlock)).toBeLessThan(1.5);
      expect(m.rowBg).toBe('rgba(0, 0, 0, 0)');
      expect(m.wordmark).toBe('rgb(255, 255, 255)');
      expect(m.overflow).toBeLessThanOrEqual(1);

      await page.screenshot({ path: path.join(evidenceDir, `overlay-${locale}-${width}.png`), clip: { x: 0, y: 0, width, height: 420 } });

      // scroll: solid past the threshold, transparent again at the top
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.querySelector('.awj-store-preview header')!.hasAttribute('data-header-solid'))).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.querySelector('.awj-store-preview header')!.hasAttribute('data-header-solid'))).toBe(false);
    });
  }
}
