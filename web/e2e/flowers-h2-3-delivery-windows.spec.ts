import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-3 — التحقق البصري لتبويب «فترات التوصيل والسعة». الخادم مُعترَض بحمولات تطابق عقد
 * `delivery-schedule` (القراءة + `slots` استبدالٌ كامل) و`shipping-zones`.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-3-delivery-windows');
});

const slot = (over: Record<string, unknown> = {}) => ({
  id: 'w1', method: 'delivery', label: 'صباحاً', label_en: 'Morning', start_time: '09:00', end_time: '12:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: 20, shipping_zone_id: null, sort_order: 0, is_active: true, ...over,
});
const SLOTS = [
  slot(),
  slot({ id: 'w2', label: 'مساءً — فترة الذروة قبل المناسبات', label_en: 'Evening — pre-event peak', start_time: '17:00', end_time: '21:30', weekdays: [4, 5, 6], capacity: 8, sort_order: 1 }),
  slot({ id: 'w3', label: 'من الفرع', label_en: null, method: 'pickup', start_time: '10:00', end_time: '20:00', weekdays: [0, 1, 2, 3, 4], capacity: null, sort_order: 2, is_active: false }),
];

function server(state: { slots: unknown[]; failSave?: boolean }) {
  return async (url: string, route: Route) => {
    if (url.includes('/shipping-zones')) {
      await route.fulfill({ json: { data: [{ id: 'z1', name: 'الرياض', match_type: 'city', match_value: 'riyadh', rate_amount_minor: 1500, is_active: true }] } });
      return true;
    }
    if (!url.includes('/delivery-schedule')) return false;
    const doc = () => ({
      data: {
        settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
        slots: state.slots,
        blocked_dates: [],
      },
    });
    if (route.request().method() === 'PUT' && url.endsWith('/slots')) {
      if (state.failSave) {
        await route.fulfill({ status: 422, json: { message: 'وقت نهاية النافذة يجب أن يلي بدايتها في اليوم نفسه.', errors: {} } });
        return true;
      }
      const body = route.request().postDataJSON() as { slots: Record<string, unknown>[] };
      state.slots = body.slots.map((s, i) => ({ id: s.id ?? `n${i}`, label_en: null, shipping_zone_id: null, sort_order: i, ...s }));
    }
    await route.fulfill({ json: doc() });
    return true;
  };
}

test.describe('FLOWERS-H2-3 — delivery windows & capacity', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — list, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ slots: SLOTS }));
        await page.goto('/commerce/delivery?tab=windows');
        await expect(page.locator('[data-window-row]')).toHaveCount(3);
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-list.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — add dialog: validation errors, day toggles, then save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { slots: SLOTS };
    await seedAdmin(page, 'ar', server(state));
    await page.goto('/commerce/delivery?tab=windows');
    await page.getByRole('button', { name: 'إضافة فترة' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await expect(dialog.getByText('هذا الحقل مطلوب.')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-dialog-invalid.png') });

    await dialog.getByLabel('اسم الفترة').fill('ظهراً');
    await dialog.getByRole('button', { name: 'إلغاء الكل' }).click();
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await expect(dialog.getByText('اختر يوماً واحداً على الأقل.')).toBeVisible();
    await dialog.getByRole('button', { name: 'الجمعة' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('button', { name: 'الجمعة' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, 'ar-390-dialog-days.png') });
    await assertNoOverflow(page);
    await dialog.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-window-row]')).toHaveCount(4);
  });

  test('EN 1440 — server rejection stays inside the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server({ slots: SLOTS, failSave: true }));
    await page.goto('/commerce/delivery?tab=windows');
    await page.getByRole('button', { name: 'Edit: صباحاً' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog').getByRole('alert').filter({ hasText: 'يلي بدايتها' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-dialog-server-error.png') });
  });

  test('AR 390 — delete confirmation reaches both actions and explains the effect', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { slots: SLOTS };
    await seedAdmin(page, 'ar', server(state));
    await page.goto('/commerce/delivery?tab=windows');
    await page.getByRole('button', { name: 'حذف: من الفرع' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('الطلبات القائمة تحتفظ بموعدها المسجّل')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-delete-confirm.png') });
    await dialog.getByRole('button', { name: 'حذف' }).click();
    await expect(page.locator('[data-window-row]')).toHaveCount(2);
  });

  test('EN 390 dark — list legible; empty state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ slots: SLOTS }), { dark: true });
    await page.goto('/commerce/delivery?tab=windows');
    await expect(page.locator('[data-window-row]')).toHaveCount(3);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', server({ slots: [] }));
    await page.goto('/commerce/delivery?tab=windows');
    await expect(page.getByText('No delivery windows yet')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-empty.png') });
  });

  test('keyboard: tabs move with arrows and action buttons are focusable with visible rings', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server({ slots: SLOTS }));
    await page.goto('/commerce/delivery');
    const rules = page.getByRole('tab', { name: 'Availability rules' });
    await rules.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Delivery windows/ })).toHaveAttribute('aria-selected', 'true');
    const edit = page.getByRole('button', { name: 'Edit: صباحاً' });
    await edit.focus();
    await expect(edit).toBeFocused();
    await page.screenshot({ path: path.join(dir, 'en-1440-focus.png') });
  });
});
