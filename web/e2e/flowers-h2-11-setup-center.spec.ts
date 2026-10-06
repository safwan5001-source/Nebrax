import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, STORE, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-11 — التحقق البصري لمركز إعداد «الهدايا والورود» (نظرة التجارة لمتجرٍ بهذا الملف).
 * الخادم مُعترَض بحمولات تطابق `vertical-setup` والمستندات الثلاثة التي تفسّر النقص.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-11-setup-center');
});

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];

function server(state: { configured: string[]; giftOn: boolean; scheduleOn: boolean; windows: number; warehouse: boolean; failSetup?: boolean }) {
  return async (url: string, route: Route) => {
    const json = (body: unknown) => route.fulfill({ json: body }).then(() => true);
    if (url.endsWith('/vertical-setup/starters')) return json({ data: { starters: { would_create: 22, facets: [{ system_key: 'occasion', facet: 'missing', missing_values: Array(12).fill({}), existing_values: [] }, { system_key: 'recipient', facet: 'missing', missing_values: Array(10).fill({}), existing_values: [] }] } } });
    if (url.endsWith('/vertical-setup')) {
      if (state.failSetup) return route.fulfill({ status: 500, json: { message: 'x' } }).then(() => true);
      return json({ data: { setup: { vertical: 'flowers_gifts', items: KEYS.map((key) => ({ key, available: true, state: state.configured.includes(key) ? 'configured' : 'not_configured', count: state.configured.includes(key) ? 4 : 0, manage_in: 'x' })) } } });
    }
    if (url.endsWith('/gift-settings')) return json({ data: { gift_settings: { enabled: state.giftOn, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true } } });
    if (url.endsWith('/delivery-schedule')) {
      return json({ data: { settings: { enabled: state.scheduleOn, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 }, slots: Array.from({ length: state.windows }, (_, i) => ({ id: `w${i}`, method: 'delivery', label: 'x', label_en: null, start_time: '09:00', end_time: '10:00', weekdays: [0], capacity: null, shipping_zone_id: null, sort_order: i, is_active: true })), blocked_dates: [] } });
    }
    if (url.endsWith('/fulfillment')) return json({ data: { fulfillment: { warehouse: state.warehouse ? { id: 'w', code: '1', name: 'المخزن الرئيسي', city: null, is_active: true } : null }, warehouses: [] } });
    return false;
  };
}

test.describe('FLOWERS-H2-11 — setup center', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — mixed state, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server({ configured: ['occasions', 'recipients'], giftOn: false, scheduleOn: true, windows: 0, warehouse: false }));
        await page.goto('/commerce');
        await expect(page.locator('[data-setup-center]')).toBeVisible();
        await expect(page.locator('[data-setup-step="delivery_scheduling"]')).toContainText(locale === 'ar' ? 'لا توجد فترة تسليم نشطة' : 'No active delivery window');
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-mixed.png`), fullPage: true });
      });
    }
  }

  test('AR 390 — complete store shows the completion message; next-step button follows the first gap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', server({ configured: ['occasions'], giftOn: false, scheduleOn: false, windows: 0, warehouse: false }));
    await page.goto('/commerce');
    await expect(page.locator('[data-setup-next]')).toHaveAttribute('href', '/commerce/merchandising');
    await page.screenshot({ path: path.join(dir, 'ar-390-next-step.png') });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'ar', server({ configured: KEYS, giftOn: true, scheduleOn: true, windows: 2, warehouse: true }));
    await page.goto('/commerce');
    await expect(page.locator('[data-setup-complete]')).toBeVisible();
    await expect(page.locator('[data-setup-next]')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-complete.png'), fullPage: true });
  });

  test('EN 1440 — starters preview then confirm; every link navigates to a real screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server({ configured: [], giftOn: false, scheduleOn: false, windows: 0, warehouse: false }));
    await page.goto('/commerce');
    await page.getByRole('button', { name: 'Preview starters' }).click();
    await expect(page.getByText(/Occasions: \+12/)).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-1440-starters-preview.png'), fullPage: true });

    const hrefs = await page.locator('[data-setup-step] a').evaluateAll((links) => links.map((l) => l.getAttribute('href')));
    expect(hrefs.length).toBe(9);
    for (const href of hrefs) expect(['/commerce/merchandising', '/commerce/gifting', '/commerce/delivery', '/products', '/commerce/appearance'].some((base) => href === base || href?.startsWith(`${base}?tab=`))).toBe(true);
    await page.locator('[data-setup-step="gift_message"] a').click();
    await expect(page).toHaveURL(/\/commerce\/gifting$/);
  });

  test('EN 390 — failed read offers retry; general store keeps the original overview', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ configured: [], giftOn: false, scheduleOn: false, windows: 0, warehouse: false, failSetup: true }));
    await page.goto('/commerce');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-error.png') });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', async () => false, { stores: [{ ...STORE, business_vertical: 'general' }] });
    await page.goto('/commerce');
    await expect(page.getByRole('heading', { name: 'Commerce command center' })).toBeVisible();
    await expect(page.locator('[data-setup-center]')).toHaveCount(0);
  });

  test('EN 390 dark', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server({ configured: ['occasions', 'gift_message'], giftOn: true, scheduleOn: true, windows: 1, warehouse: false }), { dark: true });
    await page.goto('/commerce');
    await expect(page.locator('[data-setup-center]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
