import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * FLOWERS-H2d — التحقق البصري لشاشة «التسويق والتصنيف». الخادم مُعترَض بحمولات
 * تطابق عقد `commerce/workspace/facets|collections` الفعلي.
 */
const evidenceDir = path.resolve(process.cwd(), 'test-results/flowers-h2-merchandising');

const facets = [
  {
    id: 'f1', key: 'occasion', system_key: 'occasion', name: 'المناسبة', name_en: 'Occasion', sort_order: 0, is_active: true,
    values: [
      { id: 'v1', slug: 'birthday', name: 'عيد ميلاد', name_en: 'Birthday', sort_order: 0, is_active: true, product_count: 12 },
      { id: 'v2', slug: 'graduation', name: 'تخرّج', name_en: 'Graduation', sort_order: 1, is_active: true, product_count: 7 },
      { id: 'v3', slug: 'ramadan', name: 'مناسبات رمضان وعيد الفطر المبارك', name_en: null, sort_order: 2, is_active: false, product_count: 0 },
    ],
  },
  {
    id: 'f2', key: 'recipient', system_key: 'recipient', name: 'المُهدى إليه', name_en: 'Recipient', sort_order: 1, is_active: true,
    values: [
      { id: 'v4', slug: 'her', name: 'لها', name_en: 'For her', sort_order: 0, is_active: true, product_count: 15 },
      { id: 'v5', slug: 'him', name: 'له', name_en: 'For him', sort_order: 1, is_active: true, product_count: 4 },
    ],
  },
];
const collections = [
  { id: 'c1', slug: 'best-sellers', title: 'الأكثر مبيعاً', title_en: 'Best sellers', description: null, status: 'active', sort_order: 0, member_count: 6 },
  { id: 'c2', slug: 'mothers-day', title: 'باقات عيد الأم المميزة', title_en: null, description: null, status: 'draft', sort_order: 1, member_count: 0 },
];
const members = [
  { product_id: 'p1', name: 'باقة ورد جوري أحمر فاخرة', name_en: null, sku: 'ROSE-RED', is_active: true, position: 0 },
  { product_id: 'p2', name: 'صندوق شوكولاتة بلجيكية', name_en: null, sku: 'CHOC-1', is_active: true, position: 1 },
];

async function seed(page: Page, locale: 'ar' | 'en') {
  await page.context().addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:3001' }]);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'المالك', email: 'o@test', role: 'owner', permissions: ['*'], tenant_id: 't1' }));
  });
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/commerce/workspace/facets')) return route.fulfill({ json: { data: { facets } } });
    if (url.includes('/commerce/workspace/collections/c1/products')) return route.fulfill({ json: { data: { products: members } } });
    if (url.includes('/commerce/workspace/collections')) return route.fulfill({ json: { data: { collections } } });
    if (url.includes('/commerce/workspace/storefronts')) return route.fulfill({ json: { data: { stores: [] } } });
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
}

async function assertNoOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.describe('FLOWERS-H2d — merchandising workspace', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'each test sets its own viewport');
  });

  for (const [w, h] of [[390, 844], [430, 932], [1024, 800], [1440, 960]] as const) {
    test(`AR ${w} — dimensions tab`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, 'ar');
      await page.goto('/commerce/merchandising');
      await expect(page.getByRole('heading', { name: 'المناسبة' })).toBeVisible();
      await expect(page.getByText('مناسبات رمضان وعيد الفطر المبارك')).toBeVisible();
      await assertNoOverflow(page);
      await page.screenshot({ path: path.join(evidenceDir, `ar-${w}-facets.png`), fullPage: true });
    });
  }

  test('AR 390 — collection members dialog (ordering controls)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'ar');
    await page.goto('/commerce/merchandising');
    await page.getByRole('tab', { name: 'المجموعات' }).click();
    await page.getByRole('button', { name: 'إدارة المنتجات' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('باقة ورد جوري أحمر فاخرة')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-390-members.png') });
  });

  test('AR 1440 — collections tab', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await seed(page, 'ar');
    await page.goto('/commerce/merchandising');
    await page.getByRole('tab', { name: 'المجموعات' }).click();
    await expect(page.getByText('باقات عيد الأم المميزة')).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'ar-1440-collections.png') });
  });

  test('EN 390 — LTR dimensions tab and keyboard reachability', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, 'en');
    await page.goto('/commerce/merchandising');
    await expect(page.getByRole('heading', { name: 'المناسبة' })).toBeVisible();
    const add = page.getByRole('button', { name: 'Add value' }).first();
    await add.focus();
    await expect(add).toBeFocused();
    await assertNoOverflow(page);
    await page.screenshot({ path: path.join(evidenceDir, 'en-390-facets.png'), fullPage: true });
  });
});
