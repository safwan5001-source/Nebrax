import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * AWJ-HERO-FULLBLEED / AWJ-HEADER-OVERLAY-TONE — the Canvas shows the same things the storefront proof (storefront/scripts/
 * hero-bleed-proof) measures, through the same resolver and the same stylesheet block:
 *  - `hero-bleed`: an ordinary solid header above a hero whose picture reaches both edges of the frame, has no radius, starts
 *    directly under the header and is as tall as the picture's own proportions (16:9 here) — nothing cropped or distorted;
 *  - `overlay-light`: the forced light tone is provable over the (dark) picture, so the header stays transparent with white text;
 *  - `overlay-dark`: the forced dark tone is NOT provable over that picture, so the header stays solid (fail closed).
 * The media endpoints are mocked (a dark picture with proven contrast bounds). AR RTL + EN LTR.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/awj-hero-fullbleed');
const WIDTHS = [390, 768, 1280] as const;
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


async function open(page: Page, scenario: string, locale: string, width: number) {
  await mkdir(evidenceDir, { recursive: true });
  await mockMedia(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=${scenario}&viewport=desktop`);
  await page.waitForSelector('[data-visual-root]');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

for (const locale of ['ar', 'en'] as const) {
  for (const width of WIDTHS) {
    test(`hero full-bleed + natural ratio ${locale} @ ${width}`, async ({ page }) => {
      await open(page, 'hero-bleed', locale, width);
      await page.waitForSelector('[data-sd~="hbl"] [data-sd-backdrop] img', { timeout: 15000 });
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const root = document.querySelector('.awj-store-preview') as HTMLElement;
        const frame = root.getBoundingClientRect();
        const header = root.querySelector('header') as HTMLElement;
        const hero = root.querySelector('[data-sd~="hbl"]') as HTMLElement;
        const section = hero.querySelector(':scope > section') as HTMLElement;
        const backdrop = hero.querySelector('[data-sd-backdrop]') as HTMLElement;
        const img = backdrop.querySelector('img') as HTMLImageElement;
        const r = (el: Element) => el.getBoundingClientRect();
        return {
          tokens: hero.getAttribute('data-sd') ?? '',
          frame: { l: frame.left, r: frame.right },
          headerB: r(header).bottom,
          heroT: r(hero).top,
          backdrop: { l: r(backdrop).left, r: r(backdrop).right, w: r(backdrop).width },
          section: { h: r(section).height },
          img: { w: r(img).width, h: r(img).height },
          radius: getComputedStyle(section).borderTopLeftRadius,
          backdropRadius: getComputedStyle(backdrop).borderTopLeftRadius,
          fit: getComputedStyle(img).objectFit,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(m.tokens).toContain('hbl');
      expect(m.tokens).toContain('rat');
      expect(m.backdrop.l).toBeLessThanOrEqual(m.frame.l + 0.5);
      expect(m.backdrop.r).toBeGreaterThanOrEqual(m.frame.r - 0.5);
      expect(parseFloat(m.radius)).toBe(0);
      expect(parseFloat(m.backdropRadius)).toBe(0);
      expect(Math.abs(m.heroT - m.headerB)).toBeLessThan(1.5);
      expect(Math.abs(m.section.h - m.backdrop.w * (900 / 1600))).toBeLessThan(2);
      expect(Math.abs(m.img.w / m.img.h - 1600 / 900)).toBeLessThan(0.03);
      expect(m.fit).toBe('cover');
      expect(m.overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(evidenceDir, `bleed-${locale}-${width}.png`), clip: { x: 0, y: 0, width, height: 560 } });
    });
  }

  test(`forced light tone stays transparent over a provable picture ${locale}`, async ({ page }) => {
    await open(page, 'overlay-light', locale, 1280);
    await page.waitForSelector('[data-ho~="on"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.awj-store-preview') as HTMLElement;
      const header = root.querySelector('header') as HTMLElement;
      return {
        marker: (root.querySelector('[data-ho]') as HTMLElement).getAttribute('data-ho'),
        headerH: header.getBoundingClientRect().height,
        wordmark: getComputedStyle(header.querySelector('[data-header-brand]') as HTMLElement).color,
      };
    });
    expect(m.marker).toContain('on');
    expect(m.marker).toContain('l');
    expect(m.headerH).toBeLessThan(0.5);
    expect(m.wordmark).toBe('rgb(255, 255, 255)');
    await page.screenshot({ path: path.join(evidenceDir, `tone-light-${locale}.png`), clip: { x: 0, y: 0, width: 1280, height: 420 } });
  });

  test(`forced dark tone is unprovable over a dark picture: the header stays solid ${locale}`, async ({ page }) => {
    await open(page, 'overlay-dark', locale, 1280);
    await page.waitForSelector('[data-sd-backdrop] img', { timeout: 15000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.awj-store-preview') as HTMLElement;
      const header = root.querySelector('header') as HTMLElement;
      return {
        hasMarker: root.querySelector('[data-ho]') !== null,
        headerH: header.getBoundingClientRect().height,
        // a solid header carries its surface on the <header> itself (the overlay moves it to the bands)
        headerBg: getComputedStyle(header).backgroundColor,
      };
    });
    expect(m.hasMarker).toBe(false);
    expect(m.headerH).toBeGreaterThan(20);
    expect(m.headerBg).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: path.join(evidenceDir, `tone-dark-solid-${locale}.png`), clip: { x: 0, y: 0, width: 1280, height: 420 } });
  });
}
