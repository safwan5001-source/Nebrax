import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V7d-3 — the Canvas draws the published `main` menu as the storefront does: the rail shows the served items in order
 * (the unserved "About" content page is absent), icon + badge render, the dropdown opens on hover and on focus, its panel aligns
 * to the parent's inline-start edge (left in LTR, right in RTL) and stays inside the frame, and nothing overflows. AR RTL + EN LTR,
 * the widths at which the Canvas draws the rail (tablet and up).
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v7d');
const WIDTHS = [768, 1024, 1280, 1440] as const;

for (const locale of ['ar', 'en'] as const) {
  for (const width of WIDTHS) {
    test(`canvas navigation ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/dev/customizer-visual?locale=${locale}&scenario=navigation&viewport=desktop`);
      await page.waitForSelector('[data-visual-root]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForSelector('[data-extra-nav]');

      const labels = await page.$$eval('[data-preview-canvas] [data-extra-nav]', (els) => els.map((e) => e.textContent?.trim()));
      expect(labels).toHaveLength(3);
      expect(labels.join('|')).not.toMatch(/About us|من نحن/);

      expect(await page.locator('[data-nav-badge="accent"]').count()).toBe(1);
      expect(await page.locator('[data-extra-nav] svg[aria-hidden="true"]').count()).toBeGreaterThanOrEqual(2); // icon + chevron

      // the dev page itself carries a 1px English-only overflow (also on the populated scenario); the menu must add none
      const overflowNow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const overflowBefore = await overflowNow();
      const group = page.locator('[data-nav-dropdown]');
      const panel = group.locator('[data-nav-panel]');
      await expect(panel).toBeHidden();
      await group.hover();
      await expect(panel).toBeVisible();

      const m = await page.evaluate(() => {
        const g = document.querySelector('[data-nav-dropdown]') as HTMLElement;
        const p = g.querySelector('[data-nav-panel]') as HTMLElement;
        const canvas = document.querySelector('[data-preview-canvas]') as HTMLElement;
        const gb = g.getBoundingClientRect();
        const pb = p.getBoundingClientRect();
        const cb = canvas.getBoundingClientRect();
        const first = p.querySelector('[data-nav-child]') as HTMLElement;
        const fb = first.getBoundingClientRect();
        const hit = document.elementFromPoint((fb.left + fb.right) / 2, (fb.top + fb.bottom) / 2);
        return {
          gl: gb.left, gr: gb.right, pl: pb.left, pr: pb.right, cl: cb.left, cr: cb.right,
          hit: p.contains(hit), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          children: p.querySelectorAll('[data-nav-child]').length,
          flipped: g.hasAttribute('data-flip'),
        };
      });
      expect(m.children).toBe(3);
      expect(m.hit).toBe(true);
      expect(m.overflow).toBe(overflowBefore);
      // default = the parent's inline-start edge; flipped (only when that would pass the frame) = its inline-end edge
      const startEdge = locale === 'ar' ? Math.abs(m.pr - m.gr) : Math.abs(m.pl - m.gl);
      const endEdge = locale === 'ar' ? Math.abs(m.pl - m.gl) : Math.abs(m.pr - m.gr);
      expect(m.flipped ? endEdge : startEdge).toBeLessThanOrEqual(1.5);
      expect(m.pl).toBeGreaterThanOrEqual(m.cl - 0.5);
      expect(m.pr).toBeLessThanOrEqual(m.cr + 0.5);

      // keyboard: focusing the parent label opens it too
      await page.mouse.move(2, 790);
      await expect(panel).toBeHidden();
      await group.locator('[data-extra-nav]').focus();
      await expect(panel).toBeVisible();

      if (width === 1280) await page.screenshot({ path: path.join(evidenceDir, `canvas-nav-${locale}.png`) });
    });
  }
}
