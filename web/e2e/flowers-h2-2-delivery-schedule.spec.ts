import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-2 — التحقق البصري لشاشة «التوصيل وإعدادات القناة» (قواعد التوفّر). الخادم مُعترَض بحمولات تطابق
 * عقد `commerce/workspace/storefronts/{id}/delivery-schedule` الفعلي.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-2-delivery-schedule');
});

type Doc = { settings: Record<string, unknown>; slots: unknown[]; blocked_dates: unknown[] };
const baseDoc = (settings: Record<string, unknown> = {}, slots: unknown[] = []): Doc => ({
  settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 180, cutoff_time: '15:30', max_days_ahead: 30, ...settings },
  slots,
  blocked_dates: [],
});
const slot = { id: 'w1', method: 'delivery', label: 'صباحاً', label_en: 'Morning', start_time: '09:00', end_time: '12:00', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: 20, shipping_zone_id: null, sort_order: 0, is_active: true };

function schedule(state: { doc: Doc; fail?: 'load' | 'save' }) {
  return async (url: string, route: Route) => {
    if (!url.includes('/delivery-schedule')) return false;
    if (route.request().method() === 'GET') {
      if (state.fail === 'load') await route.fulfill({ status: 500, json: { message: 'boom' } });
      else await route.fulfill({ json: { data: state.doc } });
      return true;
    }
    if (state.fail === 'save') {
      await route.fulfill({ status: 422, json: { message: 'المنطقة الزمنية غير صالحة.', errors: {} } });
      return true;
    }
    const b = route.request().postDataJSON() as Record<string, unknown>;
    state.doc = {
      ...state.doc,
      settings: { enabled: b.is_enabled, required: b.is_required, timezone: b.timezone, lead_time_minutes: b.lead_time_minutes, cutoff_time: b.cutoff_time, max_days_ahead: b.max_days_ahead },
    };
    await route.fulfill({ json: { data: state.doc } });
    return true;
  };
}

test.describe('FLOWERS-H2-2 — delivery schedule rules', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — populated rules, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, schedule({ doc: baseDoc({}, [slot]) }));
        await page.goto('/commerce/delivery');
        await expect(page.getByRole('heading', { name: locale === 'ar' ? 'جاهزية الجدولة' : 'Scheduling readiness' })).toBeVisible();
        await expect(page.locator('[data-schedule-clock]')).toBeVisible();
        expect(await page.getAttribute('html', 'dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-populated.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — enabled without windows shows a missing prerequisite (not a promise)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', schedule({ doc: baseDoc({ enabled: true }, []) }));
    await page.goto('/commerce/delivery');
    await expect(page.locator('[data-readiness="windows"]')).toHaveAttribute('data-done', 'false');
    await expect(page.locator('[data-readiness="enabled"]')).toHaveAttribute('data-done', 'true');
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-no-windows.png'), fullPage: true });
  });

  test('AR 390 — invalid lead time/days → described errors → valid save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', schedule({ doc: baseDoc({ enabled: false }, [slot]) }));
    await page.goto('/commerce/delivery');
    const days = page.getByLabel('أقصى مدة للحجز المسبق');
    await days.fill('500');
    await days.blur();
    await expect(days).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('أدخل عدداً صحيحاً بين 1 و90.')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-invalid.png'), fullPage: true });
    await days.fill('21');
    const enabled = page.getByRole('switch', { name: 'تفعيل اختيار موعد التسليم' });
    await enabled.focus();
    await page.keyboard.press('Space');
    await page.screenshot({ path: path.join(dir, 'ar-390-focus-dirty.png') });
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText('كل التعديلات محفوظة')).toBeVisible();
    await assertNoOverflow(page);
  });

  test('EN 1440 — an unsaved draft asks before an in-app link or store switch drops it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', schedule({ doc: baseDoc({}, [slot]) }));
    await page.goto('/commerce/delivery');
    const days = page.getByLabel('Maximum booking horizon');
    await days.fill('21');
    const prompts: string[] = [];
    let accept = false;
    page.on('dialog', async (dialog) => {
      prompts.push(dialog.message());
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Gifting' }).first().click();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toContain('unsaved changes');
    await expect(page).toHaveURL(/\/commerce\/delivery$/);
    await expect(days).toHaveValue('21');
    accept = true;
    await page.getByRole('link', { name: 'Gifting' }).first().click();
    await expect(page).toHaveURL(/\/commerce\/gifting$/);
  });

  test('EN 1440 — server rejection keeps the draft; load failure offers retry', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { doc: baseDoc({ enabled: false }, [slot]), fail: 'save' as 'save' | 'load' | undefined };
    await seedAdmin(page, 'en', schedule(state));
    await page.goto('/commerce/delivery');
    await page.getByRole('switch', { name: 'Enable delivery date selection' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'غير صالحة' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-save-error.png'), fullPage: true });

    state.fail = 'load';
    await page.reload();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-load-error.png') });
  });

  test('AR 390 — user without commerce.manage sees a permission state and no schedule request', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let calls = 0;
    await seedAdmin(
      page,
      'ar',
      async (url) => {
        if (url.includes('/delivery-schedule')) calls++;
        return false;
      },
      { permissions: ['products.view'], role: 'staff' },
    );
    await page.goto('/commerce/delivery');
    await expect(page.getByText('لا تملك صلاحية')).toBeVisible();
    expect(calls).toBe(0);
  });

  test('EN 390 dark — rules stay legible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', schedule({ doc: baseDoc({}, [slot]) }), { dark: true });
    await page.goto('/commerce/delivery');
    await expect(page.getByRole('heading', { name: 'Scheduling readiness' })).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
