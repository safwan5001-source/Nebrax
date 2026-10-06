import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin, STORE, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-6 — التحقق البصري لقسم «مهلة التجهيز» داخل تبويب «الهدايا والتخصيص» في ملف المنتج.
 * الخادم مُعترَض بحمولات تطابق عقد `commerce/workspace/products/{id}/preparation`.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-6-product-preparation');
});

function preparation(state: { minutes: number | null; fail?: 'load' | 'save' }) {
  return productPageHandler(async (url: string, route: Route) => {
    if (!url.includes('/products/p1/preparation')) return false;
    if (route.request().method() === 'GET') {
      if (state.fail === 'load') await route.fulfill({ status: 500, json: { message: 'boom' } });
      else await route.fulfill({ json: { data: { preparation_minutes: state.minutes } } });
      return true;
    }
    if (state.fail === 'save') {
      await route.fulfill({ status: 422, json: { message: 'مهلة التجهيز خارج المدى المسموح.' } });
      return true;
    }
    state.minutes = (route.request().postDataJSON() as { preparation_minutes: number | null }).preparation_minutes;
    await route.fulfill({ json: { data: { preparation_minutes: state.minutes } } });
    return true;
  });
}

const TAB = { ar: 'الهدايا والتخصيص', en: 'Gifting' } as const;

test.describe('FLOWERS-H2-6 — product preparation time', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — gifting tab with preparation, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, preparation({ minutes: 180 }));
        await page.goto('/products/p1');
        await page.getByRole('tab', { name: TAB[locale] }).click();
        await expect(page.locator('[data-prep-section]')).toBeVisible();
        await expect(page.locator('[data-prep-summary]')).toContainText(locale === 'ar' ? '3' : '3 hours');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-prep.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — set, invalid, clear flows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { minutes: null as number | null };
    await seedAdmin(page, 'ar', preparation(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: TAB.ar }).click();
    await expect(page.getByText('بلا مهلة خاصة — يتبع مهلة القناة فقط.')).toBeVisible();

    const input = page.getByLabel('مهلة تجهيز هذا المنتج');
    await input.fill('99');
    await page.getByLabel('وحدة المهلة').selectOption('days');
    await input.blur();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({ path: path.join(dir, 'ar-390-invalid.png'), fullPage: true });

    await input.fill('4');
    await page.getByLabel('وحدة المهلة').selectOption('hours');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText('مهلة خاصة: 4 ساعات.')).toBeVisible();
    expect(state.minutes).toBe(240);
    await page.screenshot({ path: path.join(dir, 'ar-390-saved.png'), fullPage: true });

    await input.fill('');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText('بلا مهلة خاصة — يتبع مهلة القناة فقط.')).toBeVisible();
    expect(state.minutes).toBeNull();
  });

  test('EN 1440 — server rejection; read-only user; load failure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { minutes: 60, fail: 'save' as 'save' | 'load' | undefined };
    await seedAdmin(page, 'en', preparation(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByLabel('This product’s preparation time').fill('5');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'خارج المدى' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-server-error.png'), fullPage: true });

    state.fail = 'load';
    await page.reload();
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-load-error.png') });
  });

  test('EN 390 — read-only (products.view only): fields disabled, no save controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', preparation({ minutes: 120 }), { permissions: ['products.view', 'commerce.manage'], role: 'staff' });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await expect(page.getByLabel('This product’s preparation time')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByText(/view-only access/)).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-readonly.png'), fullPage: true });
  });

  test('a store without the Flowers & Gifts type does not get the tab (non-Flowers tenants unchanged)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', preparation({ minutes: null }), { stores: [{ ...STORE, business_vertical: 'general' }] });
    await page.goto('/products/p1');
    await expect(page.getByRole('tab', { name: 'Timeline', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Gifting' })).toHaveCount(0);
  });

  test('EN 390 dark', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', preparation({ minutes: 1440 }), { dark: true });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await expect(page.locator('[data-prep-section]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
