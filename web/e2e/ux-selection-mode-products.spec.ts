import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AWJ-UX-SELECTION-MODE-1 — وضع التحديد في «إدارة المنتجات» (الـERP الأساسي) بمتصفح حقيقي
 * (سطح مكتب 1440 + جوال 390، عربي RTL/إنجليزي LTR). الخادم مُعترَض بالكامل؛ لا خلفية.
 * اللقطات تُكتب فقط حين يُضبط `SELECTION_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.SELECTION_SHOTS;

const product = (id: string, name: string, sku: string) => ({
  id, sku, barcode: `62800000${id}`, name, name_en: null, type: 'good', unit: 'pc', description: null,
  category: null, brand: null, category_id: null, brand_id: null, unit_template_id: null, reorder_level: 5,
  min_sale_price: null, discount: null, discount_type: null, profit_margin: null, tags: null, internal_notes: null,
  sales_account_id: null, cogs_account_id: null, sale_price: '75.50', purchase_price: '50.00', tax_rate: 15,
  track_inventory: true, quantity_on_hand: 21, avg_cost: '48.00', is_active: true,
});

async function open(page: Page, locale: 'ar' | 'en') {
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const calls: Array<{ method: string; path: string }> = [];
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    calls.push({ method: req.method(), path: path + url.search });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (path === '/products') {
      return json(route, {
        data: [product('1', 'فلتر زيت ديزل', 'SKU-1'), product('2', 'فلتر هواء', 'SKU-2'), product('3', 'زيت محرك', 'SKU-3')],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 3 },
      });
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/products`, { waitUntil: 'domcontentloaded' });
  return calls;
}

const visibleCheckboxes = (page: Page) => page.getByRole('checkbox').locator('visible=true');
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

for (const locale of ['ar', 'en'] as const) {
  const L = locale === 'ar'
    ? { select: 'تحديد', done: 'إنهاء التحديد', all: 'تحديد كل الصفوف المعروضة', page: 'تحديد كل منتجات الصفحة الحالية', name: 'فلتر زيت ديزل', selected: '3 محدد' }
    : { select: 'Select', done: 'Done', all: 'Select all visible rows', page: 'Select all products on this page', name: 'فلتر زيت ديزل', selected: '3 selected' };

  test(`products: default has no checkboxes, mode reveals them empty, Done restores (${locale})`, async ({ page }, info) => {
    await open(page, locale);
    await expect(page.getByText(L.name).locator('visible=true').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');

    await expect(visibleCheckboxes(page)).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `products-default-${locale}-${info.project.name}`);

    const toggle = page.getByRole('button', { name: L.select, exact: true }).locator('visible=true').first();
    // هدف لمس ≥ 44px على الجوال.
    if (info.project.name === 'mobile') {
      const box = await toggle.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await toggle.click();
    await expect(visibleCheckboxes(page).first()).toBeVisible();
    const checked = await visibleCheckboxes(page).evaluateAll((els) => els.filter((el) => (el as HTMLInputElement).checked).length);
    expect(checked).toBe(0); // الدخول لا يحدد شيئاً
    await expect(page.getByText(L.selected)).toHaveCount(0);
    await page.waitForTimeout(300);
    await noHorizontalOverflow(page);
    await shot(page, `products-mode-${locale}-${info.project.name}`);

    // سطح المكتب: صندوق رأس الجدول؛ الجوال: عنصر «تحديد الصفحة» (لا رأس للسجلات).
    await page.getByLabel(info.project.name === 'mobile' ? L.page : L.all).locator('visible=true').first().check();
    await expect(page.getByText(L.selected).locator('visible=true').first()).toBeVisible();
    await page.waitForTimeout(300);
    await noHorizontalOverflow(page);
    await shot(page, `products-selected-${locale}-${info.project.name}`);

    await page.getByRole('button', { name: L.done, exact: true }).click();
    await expect(visibleCheckboxes(page)).toHaveCount(0);
    await expect(page.getByText(L.selected)).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.select, exact: true }).locator('visible=true').first()).toBeVisible();
    await noHorizontalOverflow(page);
  });
}
