import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V7e-3 — the Canvas draws the six footer layouts from the same document as the storefront: nothing overflows, the same marks
 * appear once, identity/contact are always present, each layout's geometry holds at the width the Canvas simulates (the Canvas
 * resolves breakpoints from its `viewport` prop, not from the host window) in AR RTL and EN LTR, and on a phone the groups past the
 * fourth (columns) / every group (brand-heavy) are real disclosures that open.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v7e3');
const LAYOUTS = ['compact', 'columns', 'centered', 'editorial', 'minimal', 'brand-heavy'] as const;

for (const locale of ['ar', 'en'] as const) {
  for (const layout of LAYOUTS) {
    for (const viewport of ['desktop', 'mobile'] as const) {
      test(`canvas footer ${layout} ${locale} ${viewport}`, async ({ page }) => {
        await mkdir(evidenceDir, { recursive: true });
        await page.setViewportSize({ width: viewport === 'desktop' ? 1440 : 430, height: 900 });
        await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=footer&layout=${layout}&viewport=${viewport}`);
        await page.waitForSelector('[data-visual-root]');
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
        const footer = page.locator('footer[data-footer-layout]');
        await footer.scrollIntoViewIfNeeded();
        await expect(footer).toHaveAttribute('data-footer-layout', layout);

        const m = await page.evaluate(() => {
          const f = document.querySelector('footer[data-footer-layout]') as HTMLElement;
          const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
          const rect = (b: DOMRect | null) => (b ? { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height } : null);
          const groups = [...f.querySelectorAll('[data-footer-group], h2')].length;
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            social: f.querySelectorAll("a[aria-label]").length,
            wa: f.querySelectorAll("a[data-preview-chrome='whatsapp']").length,
            apps: f.querySelectorAll("a[href^='https://apps.apple.com']").length,
            text: f.textContent ?? '',
            band: rect(r(f.querySelector('[data-footer-band]'))),
            groupBlocks: [...f.querySelectorAll('[data-footer-group]')].map((e) => rect(r(e))),
            buttons: f.querySelectorAll('button[aria-expanded]').length,
            groups,
            footerRect: rect(r(f)),
          };
        });
        const inCanvas = await page.evaluate(() => {
          const canvas = document.querySelector('[data-preview-canvas]') as HTMLElement;
          const f = document.querySelector('footer[data-footer-layout]') as HTMLElement;
          const cb = canvas.getBoundingClientRect();
          return [...f.querySelectorAll('*')].every((e) => {
            const b = e.getBoundingClientRect();
            return b.width === 0 || (b.left >= cb.left - 1 && b.right <= cb.right + 1);
          });
        });
        // 1px English-only overflow exists on the dev page itself (see the V7d spec); the footer must add none beyond it
        expect(m.overflow).toBeLessThanOrEqual(1);
        expect(inCanvas).toBe(true);
        expect(m.text).toContain('hello@daisy.sa');
        expect(m.wa).toBe(1);
        expect(m.apps).toBe(1);
        expect(m.social).toBeGreaterThanOrEqual(1);

        if (layout === 'brand-heavy') {
          expect(m.band).not.toBeNull();
          if (viewport === 'mobile') {
            expect(m.buttons).toBe(6);
            await footer.locator('button[aria-expanded]').first().click();
            await expect(footer.locator('button[aria-expanded="true"]')).toHaveCount(1);
          } else expect(m.buttons).toBe(0);
        }
        if (layout === 'columns') {
          if (viewport === 'mobile') {
            expect(m.buttons).toBe(2);
            await footer.locator('button[aria-expanded]').first().click();
            await expect(footer.locator('button[aria-expanded="true"]')).toHaveCount(1);
          } else expect(m.buttons).toBe(0);
        }
        if (layout === 'minimal') {
          const bottomBar = await footer.evaluate((f) => [...f.children].some((c) => c.className.includes('border-t')));
          expect(bottomBar).toBe(false);
        }
        if (viewport === 'desktop' && (layout === 'columns' || layout === 'editorial')) {
          const tops = (m.groupBlocks.filter(Boolean) as Array<{ t: number }>).slice(0, layout === 'editorial' ? 2 : 3).map((b) => b.t); // editorial sets its groups two to a row
          expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
        }
        if (locale === 'ar' && viewport === 'desktop') await footer.screenshot({ path: path.join(evidenceDir, `canvas-footer-${layout}-ar.png`) });
      });
    }
  }
}
