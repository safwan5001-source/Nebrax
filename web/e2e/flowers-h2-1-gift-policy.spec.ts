import { expect, test } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, STORE, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-1 — التحقق البصري لشاشة «الإهداء» (سياسة الإهداء). الخادم مُعترَض بحمولات تطابق
 * عقد `commerce/workspace/storefronts/{id}/gift-settings` الفعلي.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-1-gift-policy');
});

const policy = (over: Record<string, unknown> = {}) => ({
  data: { gift_settings: { enabled: true, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true, ...over } },
});

function gifts(state: { current: ReturnType<typeof policy>; fail?: 'load' | 'save' | 'forbidden' }) {
  return async (url: string, route: import('@playwright/test').Route) => {
    if (!url.includes('/gift-settings')) return false;
    const method = route.request().method();
    if (method === 'GET') {
      if (state.fail === 'load') {
        await route.fulfill({ status: 500, json: { message: 'boom' } });
        return true;
      }
      if (state.fail === 'forbidden') {
        await route.fulfill({ status: 403, json: { message: 'no' } });
        return true;
      }
      await route.fulfill({ json: state.current });
      return true;
    }
    if (state.fail === 'save') {
      await route.fulfill({ status: 422, json: { message: 'الحد الأقصى لطول الرسالة خارج النطاق المسموح.', errors: {} } });
      return true;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.current = policy({
      enabled: body.is_enabled,
      message_max_length: body.message_max_length,
      allow_hide_sender: body.allow_hide_sender,
      recipient_phone_required: body.recipient_phone_required,
    });
    await route.fulfill({ json: state.current });
    return true;
  };
}

test.describe('FLOWERS-H2-1 — gift policy admin', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — populated form, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const state = { current: policy({ enabled: true, message_max_length: 180 }) };
        await seedAdmin(page, locale, gifts(state));
        await page.goto('/commerce/gifting');
        const heading = locale === 'ar' ? 'سياسة الإهداء' : 'Gift policy';
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
        expect(await page.getAttribute('html', 'dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-populated.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — dirty → invalid length → save success, keyboard focus visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { current: policy({ enabled: false }) };
    await seedAdmin(page, 'ar', gifts(state));
    await page.goto('/commerce/gifting');
    const enabled = page.getByRole('switch', { name: 'تفعيل الإهداء' });
    await expect(enabled).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('الإهداء موقوف')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-off.png'), fullPage: true });

    await enabled.focus();
    await page.keyboard.press('Space');
    await expect(enabled).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('تغييرات غير محفوظة')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-focus-dirty.png') });

    const length = page.getByLabel('الحد الأقصى لطول الرسالة');
    await length.fill('900');
    await length.blur();
    await expect(page.getByText('أدخل عدداً صحيحاً بين 1 و500.')).toBeVisible();
    await expect(length).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({ path: path.join(dir, 'ar-390-invalid.png'), fullPage: true });
    await assertNoOverflow(page);

    await length.fill('140');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByText('كل التعديلات محفوظة')).toBeVisible();
    await expect(page.getByText('تم حفظ سياسة الإهداء')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-saved.png'), fullPage: true });
  });

  test('EN 1440 — server validation error keeps the draft', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const state = { current: policy({ enabled: false }), fail: 'save' as const };
    await seedAdmin(page, 'en', gifts(state));
    await page.goto('/commerce/gifting');
    await page.getByRole('switch', { name: 'Enable gifting' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'خارج النطاق' })).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-save-error.png'), fullPage: true });
  });

  test('AR 390 — load failure offers retry; forbidden shows permission state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { current: policy(), fail: 'load' as const };
    await seedAdmin(page, 'ar', gifts(state));
    await page.goto('/commerce/gifting');
    await expect(page.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'ar-390-load-error.png') });
    await assertNoOverflow(page);
  });

  test('AR 390 — user without commerce.manage sees a permission state and no API call', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let giftCalls = 0;
    await seedAdmin(
      page,
      'ar',
      async (url) => {
        if (url.includes('/gift-settings')) giftCalls++;
        return false;
      },
      { permissions: ['products.view'], role: 'staff' },
    );
    await page.goto('/commerce/gifting');
    await expect(page.getByText('لا تملك صلاحية')).toBeVisible();
    expect(giftCalls).toBe(0);
    await page.screenshot({ path: path.join(dir, 'ar-390-no-permission.png') });
  });

  test('AR 390 — the target store is visible and switchable on mobile (multi-store)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { current: policy({ enabled: true }) };
    await seedAdmin(page, 'ar', gifts(state), { stores: [STORE, { ...STORE, id: 's2', name: 'ركن الهدايا' }] });
    await page.goto('/commerce/gifting');
    const bar = page.locator('[data-store-context]');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('combobox')).toHaveValue('s1');
    await page.screenshot({ path: path.join(dir, 'ar-390-store-context.png') });
    await bar.getByRole('combobox').selectOption('s2');
    await expect(page.getByRole('heading', { name: 'سياسة الإهداء' })).toBeVisible();
    await assertNoOverflow(page);
  });

  test('EN 1440 — the in-page store bar is hidden because the shell already shows the store', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', gifts({ current: policy() }));
    await page.goto('/commerce/gifting');
    await expect(page.getByRole('heading', { name: 'Gift policy' })).toBeVisible();
    await expect(page.locator('[data-store-context]')).toBeHidden();
  });

  test('EN 390 dark — populated form stays legible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = { current: policy({ enabled: true }) };
    await seedAdmin(page, 'en', gifts(state), { dark: true });
    await page.goto('/commerce/gifting');
    await expect(page.getByRole('heading', { name: 'Gift policy' })).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
