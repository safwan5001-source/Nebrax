import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-5 — التحقق البصري لتبويب «مخزن التنفيذ». الخادم مُعترَض بحمولات تطابق عقد
 * `storefronts/{id}/fulfillment` (مخزن حالي + قائمة مخازن المستأجر) و`delivery-schedule`.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-5-fulfillment-warehouse');
});

const WAREHOUSES = [
  { id: 'w1', code: '00001', name: 'المخزن الرئيسي — الدمام', city: 'الدمام', is_active: true },
  { id: 'w2', code: '00002', name: 'مخزن الخبر', city: 'الخبر', is_active: true },
  { id: 'w3', code: '00003', name: 'مخزن قديم', city: null, is_active: false },
];

function server(state: { current: unknown; warehouses: unknown[]; failSave?: boolean }) {
  return async (url: string, route: Route) => {
    if (url.endsWith('/fulfillment')) {
      if (route.request().method() === 'PUT') {
        if (state.failSave) {
          await route.fulfill({ status: 422, json: { message: 'لا يمكن اختيار مخزن غير نشط لتنفيذ الطلبات.' } });
          return true;
        }
        const id = (route.request().postDataJSON() as { warehouse_id: string }).warehouse_id;
        state.current = (state.warehouses as { id: string }[]).find((w) => w.id === id) ?? null;
      }
      await route.fulfill({ json: { data: { fulfillment: { warehouse: state.current }, warehouses: state.warehouses } } });
      return true;
    }
    if (url.includes('/delivery-schedule')) {
      await route.fulfill({
        json: {
          data: {
            settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
            slots: [{ id: 'a', method: 'delivery', label: 'صباحاً', label_en: null, start_time: '09:00', end_time: '12:00', weekdays: [0, 1, 2], capacity: null, shipping_zone_id: null, sort_order: 0, is_active: true }],
            blocked_dates: [],
          },
        },
      });
      return true;
    }
    return false;
  };
}

test.describe('FLOWERS-H2-5 — fulfilment warehouse', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — unassigned state, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ current: null, warehouses: WAREHOUSES }));
        await page.goto('/commerce/delivery?tab=fulfilment');
        await expect(page.locator('[data-fulfillment-current]')).toBeVisible();
        await expect(page.locator('[data-readiness="warehouse"]')).toHaveAttribute('data-done', 'false');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-unassigned.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — choose, save, prerequisite becomes met', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', server({ current: null, warehouses: WAREHOUSES }));
    await page.goto('/commerce/delivery?tab=fulfilment');
    await page.locator('#ful-warehouse').selectOption('w2');
    await expect(page.getByText('تغييرات غير محفوظة')).toBeVisible();
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.locator('[data-fulfillment-current]')).toContainText('مخزن الخبر');
    await expect(page.locator('[data-readiness="warehouse"]')).toHaveAttribute('data-done', 'true');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-assigned.png'), fullPage: true });
  });

  test('EN 1440 — inactive assigned warehouse warns; server rejection visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server({ current: WAREHOUSES[2], warehouses: WAREHOUSES, failSave: true }));
    await page.goto('/commerce/delivery?tab=fulfilment');
    await expect(page.getByText(/currently inactive/)).toBeVisible();
    await page.locator('#ful-warehouse').selectOption('w1');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'غير نشط' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-inactive-error.png'), fullPage: true });
  });

  test('EN 390 dark — no warehouses empty state links to inventory', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ current: null, warehouses: [] }), { dark: true });
    await page.goto('/commerce/delivery?tab=fulfilment');
    await expect(page.getByRole('link', { name: 'Create warehouse' })).toHaveAttribute('href', '/warehouses/new');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark-empty.png'), fullPage: true });
  });
});
