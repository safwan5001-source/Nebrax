import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V10c — the Canvas selection chip in the real builder (demo mode): name the section the merchant just added and the
 * chip carries that name on the selected section, on the inline-start edge, inside the section's own box, never widening the page,
 * and it never intercepts a click on the section. AR RTL + EN LTR at 390 / 768 / 1024 / 1440.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v10c');
const WIDTHS = [390, 768, 1024, 1440] as const;
const LOCALES = ['ar', 'en'] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openHomepagePanel(page: Page, width: number) {
  if (width >= 1024) {
    await page.locator('[data-panel-option="homepage"]').first().click();
  } else if (width < 768) {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.locator('[data-design-panel-select]').selectOption('homepage');
  } else {
    await page.locator('[data-builder-edit-toggle]').click();
    await page.locator('[data-builder-controls] #customizer-panel-select').selectOption('homepage');
  }
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`section name chip ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 960 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForTimeout(300);
      const baseline = await overflow(page);

      await openHomepagePanel(page, width);
      await page.locator('[data-add-section]:visible').first().click();
      await page.locator('[data-picker-option="benefits"]:visible').first().click();

      const name = locale === 'ar' ? 'مزايا العيد الخاصة بنا' : `Eid perks ${'very-long-name '.repeat(6)}`;
      const field = page.locator('[data-section-name]:visible').first();
      await expect(field).toBeVisible();
      await field.fill(name);

      const section = page.locator('[data-preview-canvas] [data-preview-section="benefits"]').first();
      const chip = section.locator('[data-section-chip]');
      await expect(chip).toHaveCount(1);
      await expect(chip).toContainText(name.slice(0, 12));

      const geometry = await section.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const chipEl = el.querySelector('[data-section-chip]') as HTMLElement;
        const c = chipEl.getBoundingClientRect();
        const rtl = getComputedStyle(el).direction === 'rtl';
        return {
          inside: c.left >= box.left - 1 && c.right <= box.right + 1 && c.top >= box.top - 1,
          atStart: rtl ? box.right - c.right <= 1 : c.left - box.left <= 1,
          singleLine: c.height < 32,
          pointer: getComputedStyle(chipEl).pointerEvents,
          hidden: chipEl.getAttribute('aria-hidden'),
        };
      });
      expect(geometry.inside).toBe(true);
      expect(geometry.atStart).toBe(true);
      expect(geometry.singleLine).toBe(true);
      expect(geometry.pointer).toBe('none');
      expect(geometry.hidden).toBe('true');
      expect(await overflow(page)).toBeLessThanOrEqual(baseline + 1);

      await page.screenshot({ path: path.join(evidenceDir, `chip-${locale}-${width}.png`) });
    });
  }
}
