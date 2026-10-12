import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H5-4 — Saved history & Restore in a real browser: the entry point is reachable at 390 · 430 · 768 · 1024 · 1280 · 1440
 * in Arabic RTL and English LTR (toolbar from lg, «More» menu below), the dialog fits the viewport, Preview is read-only with
 * Save/Publish disabled, and Restore lands as an UNSAVED edit (never a write) that Undo reverses.
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h5-4-saved-history');
const WIDTHS = [390, 430, 768, 1024, 1280, 1440] as const;
const LOCALES = ['ar', 'en'] as const;
const MORE = { ar: 'المزيد من الإجراءات', en: 'More actions' } as const;
const HISTORY = { ar: 'السجل المحفوظ', en: 'Saved history' } as const;

async function openBuilder(page: Page, locale: 'ar' | 'en', width: number, scenario = 'single-draft') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=${scenario}&openStore=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-experience-builder]')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

async function openHistory(page: Page, locale: 'ar' | 'en', width: number) {
  if (width >= 1024) {
    await page.locator('[data-history-open]').click();
  } else {
    await page.getByRole('button', { name: new RegExp(MORE[locale]) }).click();
    await page.getByRole('menu', { name: MORE[locale] }).getByRole('menuitem', { name: HISTORY[locale] }).click();
  }
  await page.waitForSelector('[data-history-row]');
}

const root = (page: Page) => page.locator('[data-experience-builder]');

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H5-4 — Saved history', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`${locale.toUpperCase()} ${width} — entry reachable, dialog fits, Preview read-only, Restore is unsaved + undoable`, async ({ page }) => {
        await openBuilder(page, locale, width);
        await openHistory(page, locale, width);

        const dialog = page.getByRole('dialog', { name: HISTORY[locale] });
        await expect(dialog).toBeVisible();
        await expect(page.locator('[data-history-row]')).toHaveCount(3);
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        expect(box.y).toBeGreaterThanOrEqual(-0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(900.5);
        const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflowX, 'no horizontal page scroll').toBeLessThanOrEqual(1);
        for (const button of await page.locator('[data-history-row] button').all()) {
          const b = (await button.boundingBox())!;
          expect(b.height, 'touch target').toBeGreaterThanOrEqual(35.5);
          expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
        }
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-dialog.png`) });

        // Preview the oldest snapshot (its logo is unavailable today).
        await page.locator('[data-history-row]').nth(2).locator('[data-history-preview]').click();
        await expect(page.locator('[data-history-preview-bar]')).toBeVisible();
        await expect(page.locator('[data-history-media-issues]')).toBeVisible();
        await expect(root(page)).toHaveAttribute('data-history-preview', 'true');
        await expect(page.locator('[data-save]')).toBeDisabled();
        await expect(page.locator('[data-publish]')).toBeDisabled();
        const bar = (await page.locator('[data-history-preview-bar]').boundingBox())!;
        expect(bar.x).toBeGreaterThanOrEqual(-0.5);
        expect(bar.x + bar.width).toBeLessThanOrEqual(width + 0.5);
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-preview.png`) });

        // Restore from the bar: unsaved edit, counter untouched, Undo reverses.
        const revisionBefore = await root(page).getAttribute('data-selected-version-revision');
        await page.locator('[data-history-preview-restore]').click();
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'dirty');
        await expect(root(page)).toHaveAttribute('data-history-preview', 'false');
        await expect(root(page)).toHaveAttribute('data-selected-version-revision', revisionBefore!);
        await expect(root(page)).toHaveAttribute('data-can-undo', 'true');
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-restored.png`) });
      });
    }
  }

  test('EN 1280 — Escape closes the dialog and returns focus to the entry button; Tab stays inside', async ({ page }) => {
    await openBuilder(page, 'en', 1280);
    await openHistory(page, 'en', 1280);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[data-revision-history-dialog]')));
      expect(inside, `Tab #${i + 1} stays inside the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-revision-history-dialog]')).toHaveCount(0);
    await expect(page.locator('[data-history-open]')).toBeFocused();
  });

  test('AR 1280 — a Published Version offers «Create draft», never an in-place Restore', async ({ page }) => {
    await openBuilder(page, 'ar', 1280, 'published-readonly');
    await openHistory(page, 'ar', 1280);
    await expect(page.getByRole('button', { name: 'استرداد', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-history-row]').nth(1).getByRole('button', { name: 'إنشاء مسودة' })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1280-published.png') });
  });
});
