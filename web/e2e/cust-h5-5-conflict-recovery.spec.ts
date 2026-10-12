import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H5-5 — stale-conflict recovery in a real browser, AR RTL + EN LTR at 390 · 430 · 768 · 1024 · 1280 · 1440:
 * the banner lists the explicit choices without overflowing, the primaries stay on screen, and «Save my work as a new draft»
 * lands the local edit in a separate copy (never a merge) while the original version is left alone.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h5-5-conflict-recovery');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const LABEL = {
  ar: { review: 'مراجعة النسخة الأحدث', saveAs: 'حفظ عملي كمسودة جديدة', reload: 'تحديث النسخة' },
  en: { review: 'Review newer version', saveAs: 'Save my work as a new draft', reload: 'Reload version' },
} as const;

async function openConflict(page: Page, locale: 'ar' | 'en', width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=conflict&openStore=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  // Make the draft dirty through the DOM (the inspector is not on screen at every width).
  if (width < 768) {
    await page.locator('[data-builder-mobile-bar] button').nth(2).click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((el) => el.type === 'text' && !el.closest('header'));
    if (!input) throw new Error('no editable text input found');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, input.value === '#123456' ? '#123457' : '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'dirty');
  if (width < 768) {
    await page.locator('div[role="presentation"].fixed button').first().click();
    await expect(page.locator('div[role="presentation"].fixed')).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as unknown as { __awjDevBumpRevision: () => boolean }).__awjDevBumpRevision())).toBe(true);
  await page.locator('[data-save]').click();
  await expect(page.locator('[data-version-conflict]')).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H5-5 — conflict recovery', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`${locale.toUpperCase()} ${width} — banner choices fit and the primaries stay reachable`, async ({ page }) => {
        await openConflict(page, locale, width);
        const banner = page.locator('[data-version-conflict]');
        for (const key of ['review', 'saveAs', 'reload'] as const) {
          const button = banner.getByRole('button', { name: LABEL[locale][key] });
          await expect(button).toBeVisible();
          const box = (await button.boundingBox())!;
          expect(box.x, `${key} left`).toBeGreaterThanOrEqual(-0.5);
          expect(box.x + box.width, `${key} right`).toBeLessThanOrEqual(width + 0.5);
        }
        const bannerBox = (await banner.boundingBox())!;
        expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(width + 0.5);
        const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflowX, 'no horizontal page scroll').toBeLessThanOrEqual(1);
        for (const selector of ['[data-builder-exit]', '[data-save]', '[data-publish]']) {
          const box = (await page.locator(selector).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(-0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        }
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-conflict.png`) });
      });
    }
  }

  test('EN 1280 — «Save my work as a new draft» opens a separate copy, the conflict clears, nothing is merged', async ({ page }) => {
    await openConflict(page, 'en', 1280);
    const originalId = await page.locator('[data-experience-builder]').getAttribute('data-selected-version-id');
    await page.locator('[data-version-conflict]').getByRole('button', { name: LABEL.en.saveAs }).click();
    await expect(page.locator('[data-version-conflict]')).toHaveCount(0);
    const copyId = await page.locator('[data-experience-builder]').getAttribute('data-selected-version-id');
    expect(copyId).not.toBe(originalId);
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'clean');
    await expect(page.getByText(/a copy, not a merge/)).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'en-1280-saved-as-draft.png') });
  });

  test('AR 1280 — «Review newer version» opens the saved history dialog and the draft is untouched', async ({ page }) => {
    await openConflict(page, 'ar', 1280);
    await page.locator('[data-version-conflict]').getByRole('button', { name: LABEL.ar.review }).click();
    await expect(page.locator('[data-revision-history-dialog]')).toBeVisible();
    await expect(page.locator('[data-experience-builder]')).toHaveAttribute('data-lifecycle', 'dirty');
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1280-review.png') });
  });
});
