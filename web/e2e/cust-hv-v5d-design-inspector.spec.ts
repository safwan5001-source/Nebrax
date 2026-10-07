import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-HV V5d — the Design tab of a section (ColourField, backgrounds, text colours with
 * the live contrast verdict, copy / paste / reset) is usable and nothing overflows at
 * 390 · 430 · 768 · 1024 · 1280 · 1440, in Arabic RTL and English LTR. 768–1023 has no
 * inspector on main (DEF-7 — V1B's item).
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-hv-v5d-design-inspector');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const T = {
  ar: { design: 'التصميم', solid: 'لون واحد', code: 'رمز اللون', copy: 'نسخ التصميم', paste: 'لصق التصميم', reset: 'إعادة ضبط التصميم' },
  en: { design: 'Design', solid: 'Solid', code: 'Colour code', copy: 'Copy design', paste: 'Paste design', reset: 'Reset design' },
} as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`design inspector ${locale} @ ${width}`, async ({ page }) => {
      await mkdir(evidenceDir, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('[data-experience-builder]');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      await page.waitForTimeout(300);
      const baseline = await overflow(page);
      const t = T[locale];

      if (width >= 1024) {
        await page.locator('[data-panel-option="homepage"]').first().click();
      } else if (width < 768) {
        await page.locator('[data-builder-mobile-bar] button').nth(2).click();
        await page.locator('[data-design-panel-select]').selectOption('homepage');
      } else {
        test.info().annotations.push({ type: 'DEF-7', description: 'no inspector at 768–1023 on main; V1B' });
        expect(await overflow(page)).toBeLessThanOrEqual(baseline);
        return;
      }

      // the seeded draft has no sections: add a hero (it is selected on creation)
      await page.locator('[data-add-section]:visible').first().click();
      await page.locator('[data-picker-option="hero"]:visible').first().click();
      await page.locator('[data-selected-section-settings]:visible').getByRole('button', { name: t.design, exact: true }).click();
      const inspector = page.locator('[data-design-inspector="hero"]:visible');
      await expect(inspector).toBeVisible();

      // a dark-surface section: text colours wait for a background
      await expect(inspector.locator('[data-design-needs-background]')).toBeVisible();
      await inspector.getByRole('button', { name: t.solid, exact: true }).click();
      await expect(inspector.locator('[data-design-needs-background]')).toHaveCount(0);

      // a failing explicit colour is flagged with a one-tap fix
      const body = inspector.locator('[data-colour-field="text-body"]');
      await body.getByLabel(t.code).fill('#222222');
      await expect(body.locator('[data-colour-status="bad"]')).toBeVisible();
      await page.screenshot({ path: path.join(evidenceDir, `design-bad-${locale}-${width}.png`) });
      await body.locator('[data-colour-status="bad"] button').click();
      await expect(body.locator('[data-colour-status="ok"]')).toBeVisible();

      // role swatch: keyboard-operable, a real button with a name
      const swatch = inspector.locator('[data-colour-field="bg-color"] [data-colour-role="accent"]');
      await swatch.focus();
      await page.keyboard.press('Enter');
      await expect(swatch).toHaveAttribute('aria-pressed', 'true');
      const box = await swatch.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(32);
      expect(box!.height).toBeGreaterThanOrEqual(32);

      // copy → reset (two-step) → paste restores
      await inspector.getByRole('button', { name: t.copy }).click();
      await inspector.getByRole('button', { name: t.reset }).click();
      await inspector.locator('[data-design-reset-confirm]').click();
      await expect(inspector.locator('[data-design-needs-background]')).toBeVisible();
      await inspector.getByRole('button', { name: t.paste }).click();
      await expect(inspector.locator('[data-design-needs-background]')).toHaveCount(0);

      // layout: nothing leaves the viewport horizontally
      expect(await overflow(page)).toBeLessThanOrEqual(baseline);
      const rect = await inspector.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: window.innerWidth };
      });
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(rect.width + 1);
      await page.screenshot({ path: path.join(evidenceDir, `design-${locale}-${width}.png`) });
    });
  }
}
