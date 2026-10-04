import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * FLOWERS-H1 — التحقق البصري لاختيار «نوع النشاط» داخل إعدادات المتجر.
 * الخادم مُعترَض (page.route) بحمولة تطابق عقد `commerce/workspace/storefronts`
 * الفعلي؛ لا بيانات تُخترع خارج هذا العقد.
 *
 * FLOWERS-H14: متجر الهدايا يعرض الآن «إعداد نشاط الهدايا» (حالة مشتقّة من الخادم + القيم المبدئية)
 * بدل قائمة «موصى به» الثابتة؛ المعترِض يخدم `vertical-setup` بحمولة تطابق عقد H14.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/flowers-h1-business-type');

const store = (vertical: 'general' | 'flowers_gifts') => ({
  id: 's1',
  name: 'ورد الندى',
  sales_channel_id: 'ch1',
  is_active: true,
  preview_url: 'https://nada.example.test/',
  default_locale: 'ar',
  business_vertical: vertical,
  vertical_profile: {
    key: vertical,
    recommended_capabilities:
      vertical === 'flowers_gifts'
        ? [
            { key: 'occasions', available: false },
            { key: 'recipients', available: false },
            { key: 'gift_message', available: false },
            { key: 'personalization', available: false },
            { key: 'add_ons', available: false },
            { key: 'delivery_scheduling', available: false },
            { key: 'same_day_delivery', available: false },
            { key: 'structured_content', available: false },
            { key: 'vertical_sections', available: true },
          ]
        : [],
  },
});

const SETUP_ITEMS = (occasionsDone: boolean) => [
  { key: 'occasions', available: true, state: occasionsDone ? 'configured' : 'not_configured', count: occasionsDone ? 12 : 0, manage_in: 'merchandising' },
  { key: 'recipients', available: true, state: occasionsDone ? 'configured' : 'not_configured', count: occasionsDone ? 10 : 0, manage_in: 'merchandising' },
  { key: 'gift_message', available: true, state: 'not_configured', count: 0, manage_in: 'gift_settings' },
  { key: 'personalization', available: true, state: 'not_configured', count: 0, manage_in: 'products' },
  { key: 'add_ons', available: true, state: 'not_configured', count: 0, manage_in: 'products' },
  { key: 'delivery_scheduling', available: true, state: 'not_configured', count: 0, manage_in: 'delivery_schedule' },
  { key: 'same_day_delivery', available: true, state: 'not_configured', count: 0, manage_in: 'delivery_schedule' },
  { key: 'structured_content', available: true, state: 'not_configured', count: 0, manage_in: 'products' },
  { key: 'vertical_sections', available: true, state: 'not_configured', count: 0, manage_in: 'store_builder' },
];

async function seed(page: Page, vertical: 'general' | 'flowers_gifts') {
  let applied = false;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', name: 'المالك', email: 'o@test', role: 'owner', permissions: ['*'], tenant_id: 't1',
    }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/vertical-setup/starters')) {
      if (route.request().method() === 'POST') {
        applied = true;
        return route.fulfill({ json: { data: { starters: { created: 22, facets: [] } } } });
      }
      return route.fulfill({
        json: {
          data: {
            starters: {
              would_create: 22,
              facets: [
                { system_key: 'occasion', facet: 'missing', missing_values: Array(12).fill({}), existing_values: [] },
                { system_key: 'recipient', facet: 'missing', missing_values: Array(10).fill({}), existing_values: [] },
              ],
            },
          },
        },
      });
    }
    if (url.includes('/vertical-setup')) {
      return route.fulfill({ json: { data: { setup: { vertical: 'flowers_gifts', items: SETUP_ITEMS(applied) } } } });
    }
    if (url.includes('/commerce/workspace/storefronts')) {
      return route.fulfill({ json: { data: { stores: [store(vertical)] } } });
    }
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
}

async function openSettings(page: Page, locale: 'ar' | 'en') {
  await page.context().addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:3001' }]);
  await page.goto('/commerce/stores');
  await page.getByRole('button', { name: locale === 'ar' ? 'إعدادات المتجر' : 'Store settings' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('FLOWERS-H1 — business type in store settings', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const [w, h] of [[390, 844], [430, 932], [1440, 960]] as const) {
    test(`AR ${w} — flowers & gifts selected, setup checklist, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, 'flowers_gifts');
      await openSettings(page, 'ar');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('radio', { name: /ورد وهدايا/ })).toBeChecked();
      await expect(dialog.getByText('إعداد نشاط الهدايا')).toBeVisible();
      await expect(dialog.getByText('لا شاشة بعد').first()).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${w}-flowers.png`) });
    });
  }

  test('AR 390 — general store has no setup checklist', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'general');
    await openSettings(page, 'ar');
    await expect(page.getByRole('dialog').getByRole('radio', { name: /تجزئة عامة/ })).toBeChecked();
    await expect(page.getByText('إعداد نشاط الهدايا')).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-general.png') });
  });

  test('EN 390 — LTR layout, keyboard reachable radios, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'flowers_gifts');
    await openSettings(page, 'en');
    const flowers = page.getByRole('dialog').getByRole('radio', { name: /Flowers & Gifts/ });
    await flowers.focus();
    await expect(flowers).toBeFocused();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-390-flowers.png') });
  });

  test('AR 390 — preview then add starter values refreshes the checklist', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'flowers_gifts');
    await openSettings(page, 'ar');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'معاينة القيم المبدئية' }).click();
    await expect(dialog.getByText('+12')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-starters-preview.png') });
    await dialog.getByRole('button', { name: /^إضافة \(22\)/ }).click();
    await expect(dialog.getByText('تمت إضافة القيم المبدئية (22)')).toBeVisible();
    await expect(dialog.locator('[data-setup-progress]')).toContainText('2 / 9');
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-starters-applied.png') });
  });

  test('EN 1440 — setup checklist on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seed(page, 'flowers_gifts');
    await openSettings(page, 'en');
    await expect(page.getByRole('dialog').getByText('Gift business setup')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-1440-flowers.png') });
  });
});
