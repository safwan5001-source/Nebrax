import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, productPageHandler, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-8 — التحقق البصري لقسم «إضافات المنتج». الخادم مُعترَض بحمولات تطابق عقد
 * `commerce/workspace/products/{id}/addons` وقائمة نشر المنتجات المستعملة منتقياً، و`/products/{id}` و`/variants`.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-8-product-addons');
});

type Row = Record<string, unknown>;
const addon = (id: string, over: Row = {}): Row => ({ addon_product_id: id, addon_variant_id: null, name: `منتج ${id}`, name_en: null, sku: `SKU-${id}`, product_is_active: true, max_quantity: 1, is_active: true, ...over });
const CATALOG: Record<string, Row> = {
  choc: { id: 'choc', name: 'شوكولاتة بلجيكية فاخرة', sku: 'CHOC-1', is_active: true, sale_price: '35.00', variant_state: 'simple' },
  balloon: { id: 'balloon', name: 'بالون هيليوم', sku: 'BAL-1', is_active: true, sale_price: '12.00', variant_state: 'variant_managed' },
  old: { id: 'old', name: 'منتج موقوف', sku: 'OLD-1', is_active: false, sale_price: '5.00', variant_state: 'simple' },
};

function server(state: { addons: Row[]; failSave?: boolean }) {
  return productPageHandler(async (url: string, route: Route) => {
    if (url.includes('/products/publication')) {
      await route.fulfill({ json: { data: Object.values(CATALOG).map((p) => ({ id: p.id, sku: p.sku, name: p.name, name_en: null, is_active: p.is_active, is_published: true, stores: [] })), meta: { current_page: 1, last_page: 1, per_page: 10, total: 3 } } });
      return true;
    }
    if (url.includes('/products/p1/preparation')) {
      await route.fulfill({ json: { data: { preparation_minutes: null } } });
      return true;
    }
    if (url.includes('/commerce/workspace/products/p1/addons')) {
      if (route.request().method() === 'PUT') {
        if (state.failSave) {
          await route.fulfill({ status: 422, json: { message: 'منتج الإضافة «بالون هيليوم» متعدد الخيارات — حدّد المتغيّر.' } });
          return true;
        }
        state.addons = (route.request().postDataJSON() as { addons: Row[] }).addons.map((a) => ({ name: (CATALOG[a.addon_product_id as string]?.name as string) ?? 'x', name_en: null, sku: null, product_is_active: true, ...a }));
      }
      await route.fulfill({ json: { data: { addons: state.addons } } });
      return true;
    }
    if (/\/products\/[a-z]+\/variants/.test(url)) {
      await route.fulfill({ json: { data: [{ id: 'va', display_name: 'أحمر', sku: 'BAL-R', is_active: true }, { id: 'vb', display_name: 'ذهبي', sku: 'BAL-G', is_active: true }] } });
      return true;
    }
    const m = url.match(/\/api\/products\/([a-z]+)(\?|$)/);
    if (m && CATALOG[m[1]]) {
      await route.fulfill({ json: { data: CATALOG[m[1]] } });
      return true;
    }
    return false;
  });
}

const TAB = { ar: 'الهدايا والتخصيص', en: 'Gifting' } as const;
const ADDONS = { ar: 'إضافات المنتج', en: 'Product add-ons' } as const;
const INITIAL = [addon('choc', { name: 'شوكولاتة بلجيكية فاخرة', sku: 'CHOC-1', max_quantity: 3 }), addon('balloon', { name: 'بالون هيليوم', addon_variant_id: 'va', is_active: false, max_quantity: 2 })];

test.describe('FLOWERS-H2-8 — product add-ons', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — list with read-only price, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ addons: INITIAL }));
        await page.goto('/products/p1');
        await page.getByRole('tab', { name: TAB[locale] }).click();
        await page.getByRole('tab', { name: ADDONS[locale] }).click();
        await expect(page.locator('[data-addon-row]')).toHaveCount(2);
        await expect(page.locator('[data-addon-row="choc"]')).toContainText('35');
        await assertNoOverflow(page);
        await page.locator('[data-addons-section]').screenshot({ path: path.join(dir, `${locale}-${w}-list.png`) });
      });
    }
  }

  test('AR 390 — search, pick a variant product, require a variant, add and save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { addons: [] as Row[] };
    await seedAdmin(page, 'ar', server(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: TAB.ar }).click();
    await page.getByRole('tab', { name: ADDONS.ar }).click();
    await expect(page.getByText('لا توجد إضافات')).toBeVisible();
    await page.getByRole('button', { name: 'إضافة إضافة' }).first().click();
    await page.locator('[data-addon-picker]').getByRole('searchbox').fill('بالون');
    await page.locator('[data-addon-picker] li', { hasText: 'بالون هيليوم' }).getByRole('button', { name: 'اختيار' }).click();
    const candidate = page.locator('[data-addon-candidate]');
    await expect(candidate).toContainText('12');
    await expect(candidate.getByRole('button', { name: 'إضافة إلى القائمة' })).toBeDisabled();
    await page.screenshot({ path: path.join(dir, 'ar-390-variant-required.png'), fullPage: true });
    await candidate.getByLabel('المتغيّر').selectOption('vb');
    await candidate.getByRole('button', { name: 'إضافة إلى القائمة' }).click();
    await expect(page.locator('[data-addon-row="balloon"]')).toBeVisible();
    await assertNoOverflow(page);
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.locator('[data-addons-section]').getByText('كل التعديلات محفوظة')).toBeVisible();
    expect(state.addons[0]).toMatchObject({ addon_product_id: 'balloon', addon_variant_id: 'vb' });
    await page.screenshot({ path: path.join(dir, 'ar-390-saved.png'), fullPage: true });
  });

  test('EN 1440 — inactive product refused; server rejection visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { addons: INITIAL, failSave: true };
    await seedAdmin(page, 'en', server(state));
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: ADDONS.en }).click();
    await page.getByRole('button', { name: 'Add an add-on' }).first().click();
    await page.locator('[data-addon-picker]').getByRole('searchbox').fill('old');
    await page.locator('[data-addon-picker] li', { hasText: 'منتج موقوف' }).getByRole('button', { name: 'Choose' }).click();
    await expect(page.getByText('This product is inactive and cannot be added.')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-inactive.png'), fullPage: true });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('switch', { name: 'شوكولاتة بلجيكية فاخرة: active' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'حدّد المتغيّر' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-server-error.png'), fullPage: true });
  });

  test('EN 390 read-only and dark empty', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ addons: INITIAL }), { permissions: ['products.view'], role: 'staff' });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: ADDONS.en }).click();
    await expect(page.getByRole('button', { name: 'Add an add-on' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-readonly.png'), fullPage: true });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', server({ addons: [] }), { dark: true });
    await page.goto('/products/p1');
    await page.getByRole('tab', { name: 'Gifting' }).click();
    await page.getByRole('tab', { name: ADDONS.en }).click();
    await expect(page.getByText('No add-ons')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-dark-empty.png'), fullPage: true });
  });
});
