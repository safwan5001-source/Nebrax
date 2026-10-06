import { expect, test, type Route } from '@playwright/test';
import path from 'node:path';
import { assertNoOverflow, evidenceDir, seedAdmin, STORE, VIEWPORTS } from './helpers/flowers-admin';

/**
 * FLOWERS-H2-12 — التحقق البصري للتهيئة الموجَّهة. الخادم مُعترَض بحمولات العقد الفعلي؛ لا حالة تُخزَّن في العميل.
 */
let dir = '';
test.beforeAll(async () => {
  dir = await evidenceDir('flowers-h2-12-onboarding');
});

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];

const server = (configured: string[]) => async (url: string, route: Route) => {
  const json = (body: unknown) => route.fulfill({ json: body }).then(() => true);
  if (url.endsWith('/vertical-setup/starters')) return json({ data: { starters: { would_create: 22, facets: [{ system_key: 'occasion', facet: 'missing', missing_values: Array(12).fill({}), existing_values: [] }] } } });
  if (url.endsWith('/vertical-setup')) return json({ data: { setup: { vertical: 'flowers_gifts', items: KEYS.map((key) => ({ key, available: true, state: configured.includes(key) ? 'configured' : 'not_configured', count: configured.includes(key) ? 3 : 0, manage_in: 'x' })) } } });
  if (url.endsWith('/gift-settings')) return json({ data: { gift_settings: { enabled: false, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true } } });
  if (url.endsWith('/delivery-schedule')) return json({ data: { settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 }, slots: [], blocked_dates: [] } });
  if (url.endsWith('/fulfillment')) return json({ data: { fulfillment: { warehouse: null }, warehouses: [] } });
  return false;
};

test.describe('FLOWERS-H2-12 — guided onboarding', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [w, h] of VIEWPORTS) {
      test(`${locale.toUpperCase()} ${w} — resumes at first gap, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await seedAdmin(page, locale, server(['occasions', 'recipients']));
        await page.goto('/commerce/onboarding');
        await expect(page.locator('[data-onboarding-step="gift_message"]')).toBeVisible();
        await expect(page.locator('[data-onboarding-nav]')).toHaveCount(9);
        await assertNoOverflow(page);
        await page.screenshot({ path: path.join(dir, `${locale}-${w}-resume.png`), fullPage: true });
      });
    }
  }

  test('EN 390 — next/back walk and the URL keeps the position', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server([]));
    await page.goto('/commerce/onboarding');
    await expect(page.locator('[data-onboarding-step="occasions"]')).toBeVisible();
    await expect(page.locator('[data-starters-box]')).toBeVisible();
    await page.locator('[data-onboarding-next]').click();
    await expect(page.locator('[data-onboarding-step="recipients"]')).toBeVisible();
    await expect(page).toHaveURL(/step=recipients/);
    await page.reload();
    await expect(page.locator('[data-onboarding-step="recipients"]')).toBeVisible();
    await page.screenshot({ path: path.join(dir, 'en-390-walk.png'), fullPage: true });
  });

  test('EN 1440 — nav jumps, open-screen link targets the real screen, last step finishes to overview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seedAdmin(page, 'en', server([]));
    await page.goto('/commerce/onboarding');
    await page.locator('[data-onboarding-nav="same_day_delivery"]').click();
    await expect(page.locator('[data-onboarding-open]')).toHaveAttribute('href', '/commerce/delivery?tab=fulfilment');
    await page.locator('[data-onboarding-nav="vertical_sections"]').click();
    await expect(page.locator('[data-onboarding-finish]')).toHaveAttribute('href', '/commerce');
    await page.screenshot({ path: path.join(dir, 'en-1440-last.png'), fullPage: true });
  });

  test('AR 390 — complete store shows the completion note; overview links in to guided setup', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'ar', server(KEYS));
    await page.goto('/commerce/onboarding');
    await expect(page.locator('[data-onboarding-complete]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'ar-390-complete.png'), fullPage: true });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'ar', server([]));
    await page.goto('/commerce');
    await page.locator('[data-setup-guided]').click();
    await expect(page).toHaveURL(/\/commerce\/onboarding$/);
  });

  test('EN 390 — general store and a user without commerce.manage see states and issue no setup request', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const hits: string[] = [];
    await seedAdmin(page, 'en', async (url) => {
      if (/vertical-setup|gift-settings|delivery-schedule|fulfillment/.test(url)) hits.push(url);
      return false;
    }, { stores: [{ ...STORE, business_vertical: 'general' }] });
    await page.goto('/commerce/onboarding');
    await expect(page.getByText('This store uses the “General retail” profile')).toBeVisible();
    expect(hits).toEqual([]);
    await page.screenshot({ path: path.join(dir, 'en-390-general.png') });

    await page.unroute('**/api/**');
    await seedAdmin(page, 'en', async (url) => {
      if (/vertical-setup|gift-settings|delivery-schedule|fulfillment/.test(url)) hits.push(url);
      return false;
    }, { permissions: ['products.view'], role: 'accountant' });
    await page.goto('/commerce/onboarding');
    await expect(page.getByText(/permission/i).first()).toBeVisible();
    expect(hits).toEqual([]);
  });

  test('EN 390 dark', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page, 'en', server(['occasions']), { dark: true });
    await page.goto('/commerce/onboarding');
    await expect(page.locator('[data-onboarding]')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(dir, 'en-390-dark.png'), fullPage: true });
  });
});
