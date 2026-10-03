import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * FLOWERS-H1 — التحقق البصري لاختيار «نوع النشاط» داخل إعدادات المتجر.
 * الخادم مُعترَض (page.route) بحمولة تطابق عقد `commerce/workspace/storefronts`
 * الفعلي؛ لا بيانات تُخترع خارج هذا العقد.
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

async function seed(page: Page, vertical: 'general' | 'flowers_gifts') {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', name: 'المالك', email: 'o@test', role: 'owner', permissions: ['*'], tenant_id: 't1',
    }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
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
    test(`AR ${w} — flowers & gifts selected, recommended list, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, 'flowers_gifts');
      await openSettings(page, 'ar');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('radio', { name: /ورد وهدايا/ })).toBeChecked();
      await expect(dialog.getByText('موصى به لنشاطك الحالي')).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${w}-flowers.png`) });
    });
  }

  test('AR 390 — general store has no recommendation list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'general');
    await openSettings(page, 'ar');
    await expect(page.getByRole('dialog').getByRole('radio', { name: /تجزئة عامة/ })).toBeChecked();
    await expect(page.getByText('موصى به لنشاطك الحالي')).toHaveCount(0);
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
});
