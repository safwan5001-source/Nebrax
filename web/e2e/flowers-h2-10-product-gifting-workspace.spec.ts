import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin, STORE, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-10 — التحقق البصري لمساحة «الهدايا والتخصيص» الموحَّدة: أربعة أقسام بشريط فرعي وعدّادات من الخادم،
 * رابط عميق، مسوّدة تبقى عند التنقّل، حفظٌ واحد ظاهر، وغيابُ التبويب لمتاجر التجزئة العامة.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-10-product-gifting-workspace');
});

const handler = productPageHandler(async (url: string, route: Route) => {
  if (url.includes('/products/p1/preparation')) return route.fulfill({ json: { data: { preparation_minutes: 180 } } }).then(() => true);
  if (url.includes('/products/p1/personalization')) {
    return route.fulfill({ json: { data: { fields: [
      { key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: null, help_text: null, is_required: true, max_length: 20, is_active: true, options: [] },
      { key: 'ribbon', type: 'select', label: 'لون الشريط', label_en: null, help_text: null, is_required: false, max_length: null, is_active: true, options: [{ value_key: 'red', label: 'أحمر', label_en: null, is_active: true }] },
    ] } } }).then(() => true);
  }
  if (url.includes('/products/p1/addons')) {
    return route.fulfill({ json: { data: { addons: [{ addon_product_id: 'a', addon_variant_id: null, name: 'شوكولاتة بلجيكية', name_en: null, sku: 'CHOC', product_is_active: true, max_quantity: 2, is_active: true }] } } }).then(() => true);
  }
  if (url.includes('/products/p1/content')) {
    return route.fulfill({ json: { data: { blocks: [
      { block_type: 'composition', body: '٢٤ وردة', body_en: null, is_active: true },
      { block_type: 'care', body: 'تُحفظ في ماء بارد', body_en: null, is_active: true },
      { block_type: 'storage', body: 'مكان بارد', body_en: null, is_active: true },
    ] } } }).then(() => true);
  }
  if (/\/api\/products\/a(\?|$)/.test(url)) return route.fulfill({ json: { data: { id: 'a', name: 'شوكولاتة بلجيكية', sku: 'CHOC', is_active: true, sale_price: '35.00', variant_state: 'simple' } } }).then(() => true);

  return false;
});

const TAB = { ar: 'الهدايا والتخصيص', en: 'Gifting' } as const;

test.describe('FLOWERS-H2-10 — unified product gifting workspace', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — sub-navigation with counts, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, handler);
        await page.goto('/products/p1');
        await page.getByRole('tab', { name: TAB[locale] }).click();
        const subtabs = page.locator('[data-product-gifting] [role="tablist"]');
        await expect(subtabs.getByRole('tab')).toHaveCount(4);
        await expect(subtabs.getByRole('tab').nth(3)).toContainText('3');
        await assertNoOverflow(page);
        await page.locator('[data-product-gifting]').screenshot({ path: path.join(dir, `${locale}-${w}-unified.png`) });
      });
    }
  }

  test('AR 390 — deep link opens the add-ons section; arrow keys move between sections', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', handler);
    await page.goto('/products/p1?tab=gifting&section=addons');
    await expect(page.locator('[data-addons-section]')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^الإضافات/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /^الإضافات/ }).focus();
    await page.keyboard.press('ArrowLeft'); // RTL: يتقدّم بالترتيب المنطقي
    await expect(page.getByRole('tab', { name: /^المحتوى/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-content-section]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-deeplink-keyboard.png') });
  });

  test('EN 1440 — a draft survives switching sections and the page shows a single save bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', handler);
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByLabel('This product’s preparation time').fill('9');
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(1);
    await page.getByRole('tab', { name: /^Personalization/ }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(1);
    await page.getByRole('tab', { name: /^Preparation/ }).click();
    await expect(page.getByLabel('This product’s preparation time')).toHaveValue('9');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-draft-kept.png'), fullPage: true });
  });

  test('a general-retail tenant gets no Gifting tab and the profile is untouched', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', handler, { stores: [{ ...STORE, business_vertical: 'general' }] });
    await page.goto('/products/p1?tab=gifting');
    await expect(page.getByRole('tab', { name: 'Product information' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Gifting' })).toHaveCount(0);
    await expect(page.locator('[data-product-gifting]')).toHaveCount(0);
  });

  test('EN 390 dark', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', handler, { dark: true });
    await page.goto('/products/p1?tab=gifting&section=personalization');
    await expect(page.locator('[data-personalization-section]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
