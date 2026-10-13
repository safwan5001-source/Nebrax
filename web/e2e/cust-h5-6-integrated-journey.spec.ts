import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * CUST-H5-6 — the H5 Horizon as ONE journey in a real browser, AR RTL + EN LTR at phone / tablet / desktop:
 * edit → Undo/Redo → Save (hard boundary) → saved history → read-only Preview → Restore (unsaved, revision untouched) → Undo.
 * Layout is asserted at every step (no horizontal page scroll; primaries stay on screen).
 */

const evidenceDir = path.resolve(process.cwd(), 'test-results/cust-h5-6-integrated-journey');
const VIEWPORTS = [390, 768, 1280] as const;
const LOCALES = ['ar', 'en'] as const;
const L = {
  ar: { more: 'المزيد من الإجراءات', undo: 'تراجع عن التعديل', redo: 'إعادة التعديل', history: 'السجل المحفوظ' },
  en: { more: 'More actions', undo: 'Undo', redo: 'Redo', history: 'Saved history' },
} as const;

const root = (page: Page) => page.locator('[data-experience-builder]');

async function open(page: Page, locale: 'ar' | 'en', width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/customizer-versions?locale=${locale}&scenario=single-draft&openStore=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-experience-builder]');
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(400);
  await expect(root(page)).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

async function edit(page: Page, width: number) {
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
  await expect(root(page)).toHaveAttribute('data-lifecycle', 'dirty');
  if (width < 768) {
    await page.locator('div[role="presentation"].fixed button').first().click();
    await expect(page.locator('div[role="presentation"].fixed')).toHaveCount(0);
  }
}

async function history(page: Page, kind: 'undo' | 'redo', locale: 'ar' | 'en', width: number) {
  if (width >= 768) {
    await page.locator(`[data-history-action="${kind}"]`).click();
  } else {
    await page.getByRole('button', { name: new RegExp(L[locale].more) }).click();
    await page.getByRole('menu', { name: L[locale].more }).getByRole('menuitem', { name: L[locale][kind] }).click();
  }
}

async function openHistory(page: Page, locale: 'ar' | 'en', width: number) {
  if (width >= 1024) {
    await page.locator('[data-history-open]').click();
  } else {
    await page.getByRole('button', { name: new RegExp(L[locale].more) }).click();
    await page.getByRole('menu', { name: L[locale].more }).getByRole('menuitem', { name: L[locale].history }).click();
  }
  await page.waitForSelector('[data-history-row]');
}

async function noOverflow(page: Page, width: number) {
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowX, 'no horizontal page scroll').toBeLessThanOrEqual(1);
  for (const selector of ['[data-builder-exit]', '[data-save]', '[data-publish]']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x, selector).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 0.5);
  }
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('CUST-H5-6 — integrated journey', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own explicit viewport');
  });

  for (const locale of LOCALES) {
    for (const width of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${width} — edit, undo/redo, save boundary, history preview, restore, undo`, async ({ page }) => {
        await open(page, locale, width);

        // edit → Undo → Redo
        await edit(page, width);
        await noOverflow(page, width);
        await history(page, 'undo', locale, width);
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'clean');
        await history(page, 'redo', locale, width);
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'dirty');

        // Save is the hard boundary: nothing left to undo, revision advanced.
        const revisionBefore = Number(await root(page).getAttribute('data-selected-version-revision'));
        await page.locator('[data-save]').click();
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'clean');
        expect(Number(await root(page).getAttribute('data-selected-version-revision'))).toBeGreaterThan(revisionBefore);
        await expect(root(page)).toHaveAttribute('data-can-undo', 'false');
        await noOverflow(page, width);

        // saved history → read-only preview → restore
        await openHistory(page, locale, width);
        await noOverflow(page, width);
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-history.png`) });
        await page.locator('[data-history-row]').nth(2).locator('[data-history-preview]').click();
        await expect(page.locator('[data-history-preview-bar]')).toBeVisible();
        await expect(page.locator('[data-save]')).toBeDisabled();
        await expect(page.locator('[data-publish]')).toBeDisabled();
        await noOverflow(page, width);
        const revisionAtRestore = await root(page).getAttribute('data-selected-version-revision');
        await page.locator('[data-history-preview-restore]').click();
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'dirty');
        await expect(root(page)).toHaveAttribute('data-selected-version-revision', revisionAtRestore!);
        await expect(root(page)).toHaveAttribute('data-can-undo', 'true');
        await page.screenshot({ path: path.join(evidenceDir, `${locale}-${width}-restored.png`) });

        // …and Undo reverses the restore.
        await history(page, 'undo', locale, width);
        await expect(root(page)).toHaveAttribute('data-lifecycle', 'clean');
        await noOverflow(page, width);
      });
    }
  }
});
