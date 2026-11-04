import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COM-CATALOG-3 — التحديد الجماعي والنشر الجماعي في «المنتجات المنشورة» بمتصفح حقيقي
 * (سطح مكتب 1440 + جوال 390، عربي RTL/إنجليزي LTR). الخادم مُعترَض بالكامل؛ لا خلفية.
 * اللقطات تُكتب فقط حين يُضبط `BULK_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.BULK_SHOTS;

const store = (id: string, name: string) => ({ id, name, sales_channel_id: `c-${id}`, is_active: true, default_locale: 'ar', business_vertical: 'general', domains: [] });
const productRow = (id: string, name: string, published: boolean) => ({
  id, sku: `SKU-${id}`, name, name_en: null, is_active: true, is_published: published,
  stores: [{ id: 's1', name: 'زهور طيبة', is_published: published }],
});

async function open(page: Page, opts: { locale?: 'ar' | 'en'; stores?: number } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const stores = [store('s1', 'زهور طيبة'), ...(opts.stores === 2 ? [store('s2', 'زهور الرشد')] : [])];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    calls.push({ method: req.method(), path: path + url.search, body: req.postData() ? JSON.parse(req.postData() as string) : null });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/commerce/workspace/storefronts') return json(route, { data: { stores } });
    if (path === '/commerce/workspace/products/publication') {
      return json(route, {
        data: [productRow('p1', 'باقة ورد جوري', false), productRow('p2', 'شوكولاتة فاخرة', true), productRow('p3', 'بالون هيليوم', false)],
        meta: { current_page: 1, last_page: 1, per_page: 25, total: 3 },
      });
    }
    if (path === '/commerce/workspace/products/publication/bulk') {
      const body = JSON.parse(req.postData() as string) as { action: string; ids: string[]; storefront_id: string };
      return json(route, {
        data: {
          action: body.action, storefront_id: body.storefront_id,
          summary: { requested: body.ids.length, updated: body.ids.length - 1, unchanged: 0, rejected: 1, failed: 0 },
          results: body.ids.map((id, i) => (i === 0 ? { id, status: 'rejected', reason: 'not_found' } : { id, status: 'updated' })),
        },
      });
    }
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/commerce/published-products`, { waitUntil: 'domcontentloaded' });
  return calls;
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
/** الجدول (md+) وسجلات الجوال كلاهما في DOM؛ المرئي فقط هو المقصود. */
const visibleBox = (page: Page, label: string) => page.getByLabel(label).locator('visible=true').first();

for (const locale of ['ar', 'en'] as const) {
  const L = locale === 'ar'
    ? { name: 'باقة ورد جوري', row: 'تحديد: باقة ورد جوري', all: 'تحديد كل عناصر هذه الصفحة', publish: 'نشر المحدد', confirm: 'تأكيد النشر', selected: 'المحدد: 2', partial: 'اكتملت العملية جزئياً: بعض العناصر لم تُنفَّذ.' }
    : { name: 'باقة ورد جوري', row: 'Select: باقة ورد جوري', all: 'Select all items on this page', publish: 'Publish selected', confirm: 'Confirm publish', selected: 'Selected: 2', partial: 'The operation completed partially: some items were not processed.' };

  test(`select, confirm, partial report, no overflow (${locale})`, async ({ page }, info) => {
    const calls = await open(page, { locale });
    await expect(page.getByText(L.name).locator('visible=true').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');

    await visibleBox(page, L.row).check();
    await visibleBox(page, L.all).check();
    await expect(page.getByTestId('bulk-selected-count')).toHaveText(locale === 'ar' ? 'المحدد: 3' : 'Selected: 3');
    await visibleBox(page, L.row).uncheck();
    await expect(page.getByTestId('bulk-selected-count')).toHaveText(L.selected);
    await noHorizontalOverflow(page);
    await shot(page, `bulk-selected-${locale}-${info.project.name}`);

    await page.getByRole('button', { name: L.publish, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `bulk-confirm-${locale}-${info.project.name}`);
    expect(calls.some((c) => c.path.endsWith('/bulk'))).toBe(false); // لا طلب قبل التأكيد

    await dialog.getByRole('button', { name: L.confirm }).click();
    await expect(page.getByText(L.partial)).toBeVisible();
    await shot(page, `bulk-result-${locale}-${info.project.name}`);

    const bulk = calls.filter((c) => c.path.endsWith('/bulk'));
    expect(bulk).toHaveLength(1);
    const body = bulk[0].body as { action: string; storefront_id: string; ids: string[] };
    expect(body.action).toBe('publish');
    expect(body.storefront_id).toBe('s1');
    expect(body.ids).toEqual(['p2', 'p3']); // المحدد صراحةً فقط (p1 أُلغي تحديده)
    // أي طلب غير GET هو الجماعي وحده: لا PUT مفرد.
    expect(calls.filter((c) => c.method !== 'GET').map((c) => c.path)).toEqual(['/commerce/workspace/products/publication/bulk']);
  });
}

test('changing the search clears the selection', async ({ page }) => {
  await open(page);
  await visibleBox(page, 'تحديد كل عناصر هذه الصفحة').check();
  await expect(page.getByTestId('bulk-selected-count')).toBeVisible();
  await page.getByLabel('بحث في المنتجات').fill('ورد');
  await expect(page.getByTestId('bulk-selected-count')).toHaveCount(0);
  await expect(page.getByText('أُلغي التحديد لأن البحث أو الفلاتر تغيّرت.')).toBeVisible();
});

test('with two stores the target store must be chosen before acting', async ({ page }, info) => {
  await open(page, { stores: 2 });
  await visibleBox(page, 'تحديد: باقة ورد جوري').check();
  await expect(page.getByRole('button', { name: 'نشر المحدد', exact: true })).toBeDisabled();
  await shot(page, `bulk-two-stores-${info.project.name}`);
  await page.getByLabel('المتجر المستهدف').selectOption('s2');
  await expect(page.getByRole('button', { name: 'نشر المحدد', exact: true })).toBeEnabled();
  await noHorizontalOverflow(page);
});
