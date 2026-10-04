import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * FLOWERS-H9c / ADR-21 — merchant Canvas for the data-backed home sections.
 * Uses the dev-only `/dev/customizer-visual?scenario=data-sections` fixture
 * (the real `StorefrontPreviewCanvas`). The Canvas must show only authored
 * text and honest placeholders — never products, counts or delivery dates —
 * and must flag a section the storefront would omit.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/flowers-h9c-data-sections');

for (const locale of ['ar', 'en'] as const) {
  for (const viewport of ['mobile', 'desktop'] as const) {
    test(`data-backed sections — ${locale} ${viewport}`, async ({ page }) => {
      await page.setViewportSize(
        viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      );
      await page.goto(
        `/dev/customizer-visual?locale=${locale}&scenario=data-sections&viewport=${viewport}`,
      );
      const sections = page.locator('[data-home-data-section]');
      await expect(sections).toHaveCount(4);
      await expect(page.locator('[data-home-data-section][data-incomplete]')).toHaveCount(1);
      await expect(page.locator('[data-home-data-section="productShelf"] img')).toHaveCount(0);

      const text = (await sections.allTextContents()).join(' ');
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).not.toMatch(/SAR|ر\.س/);

      // The shared preview shell has a pre-existing 1px document overflow in
      // LTR (also on the "populated" scenario); assert on the sections instead.
      const viewportWidth = page.viewportSize()?.width ?? 0;
      for (const box of await sections.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().toJSON()),
      )) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewportWidth);
      }

      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: path.join(evidenceDir, `data-sections-${locale}-${viewport}.png`),
        fullPage: true,
      });
    });
  }
}
