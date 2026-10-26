import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COMMERCE-ORDERS-O1b — قائمة وتفاصيل طلبات المتجر في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي،
 * فاتح/داكن). الخادم مُعترَض بالكامل؛ لا خلفية. اللقطات تُكتب فقط حين يُضبط `O1B_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.O1B_SHOTS;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const sar = (m: number) => ({ amount_minor: m, currency: 'SAR' });

const channel = { sales_channel_id: 'c1', sales_channel_name: 'متجر الويب', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'زهور طيبة' };
const payment = { intent_id: 'i1', method: 'cod', status: 'awaiting_collection', payment_method_name: 'الدفع عند الاستلام', amount_minor: 11500, collected_at: null, paid_at: null, cancelled_at: null };
const summary = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID, number: 'CORD-100', status: 'confirmed', created_at: '2026-10-20T10:00:00+03:00', confirmed_at: '2026-10-20T10:00:00+03:00',
  total: sar(11500), items_count: 2, delivery_method: 'standard', customer: { name: 'سارة العتيبي', phone: '0500000001' }, channel, payment, ...over,
});
const detail = {
  ...summary(), partner_id: null, delivery_amount: sar(1500),
  contact: { name: 'سارة العتيبي', company: null, email: 'sara@example.test', phone: '0500000001', vat_number: null, cr_number: null },
  shipping_address: { recipient_name: 'منى', phone: '0500000002', country: 'SA', region: 'الشرقية', city: 'الدمام', district: 'الشاطئ', street: 'شارع الخليج', building_no: '1234', additional_number: null, postal_code: '32415', notes: null },
  billing_address: null,
  gift: { recipient_name: 'منى', recipient_phone: '0500000002', sender_display_name: 'سارة', hide_sender: false, message: 'كل عام وأنتم بخير' },
  schedule: { method: 'standard', date: '2026-10-25', slot: { label: 'مساءً', label_en: 'Evening', start_time: '17:00', end_time: '20:00' }, timezone: 'Asia/Riyadh' },
  items: [
    { id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'باقة ورد جوري', variant: null, unit_name: null, quantity: 2, unit_price: sar(5000), line_total: sar(10000), personalization: [{ key: 'card', label: 'نص البطاقة', label_en: 'Card text', value: 'مبروك', value_label: null }] },
  ],
  payment: { ...payment, collection_note: null, attempts: [] },
  accounting: { posted: false },
};

async function open(page: Page, path: string, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; ordersStatus?: number } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}${url.search}`);
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [
      { id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts', domains: [] },
      { id: 's2', name: 'زهور الرشد', sales_channel_id: 'c2', is_active: true, default_locale: 'ar', business_vertical: 'general', domains: [] },
    ] } });
    if (p === '/commerce/orders') {
      if (opts.ordersStatus) return json(route, { message: 'forbidden' }, opts.ordersStatus);
      return json(route, { data: [summary(), summary({ id: '22222222-2222-4222-8222-222222222222', number: 'CORD-101', payment: { ...payment, method: 'online', status: 'paid', payment_method_name: 'مدى' }, total: sar(32000) })], meta: { current_page: 1, per_page: 20, total: 2, last_page: 1 } });
    }
    if (p === `/commerce/orders/${ORDER_ID}`) return json(route, { data: detail });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shown = (page: Page, text: string) => page.getByText(text).locator('visible=true').first();

test.describe('O1b staff orders UI', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`list renders (${locale}) and requests only GET`, async ({ page }, info) => {
      const requests = await open(page, '/commerce/orders', { locale });
      await expect(shown(page, 'CORD-100')).toBeVisible();
      await expect(shown(page, 'CORD-101')).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `list-${locale}-${info.project.name}`);
      expect(requests.filter((r) => r.startsWith('GET /commerce/orders')).length).toBeGreaterThan(0);
      expect(requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r))).toEqual([]);
    });
  }

  test('list dark theme', async ({ page }, info) => {
    await open(page, '/commerce/orders', { theme: 'dark' });
    await expect(shown(page, 'CORD-100')).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `list-ar-dark-${info.project.name}`);
  });

  test('detail shows the accounting warning and no write actions', async ({ page }, info) => {
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`);
    await expect(page.getByRole('heading', { name: 'CORD-100' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('لم يُرحَّل محاسبياً');
    await noHorizontalOverflow(page);
    await shot(page, `detail-ar-${info.project.name}`);
    for (const name of ['إلغاء', 'قبول', 'شحن', 'تحصيل الدفعة']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    expect(requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r))).toEqual([]);
  });

  test('detail in English', async ({ page }, info) => {
    await open(page, `/commerce/orders/${ORDER_ID}`, { locale: 'en' });
    await expect(page.getByRole('alert')).toContainText('has not been posted to accounting');
    await shot(page, `detail-en-${info.project.name}`);
  });

  test('without the permission nothing is requested', async ({ page }) => {
    const requests = await open(page, '/commerce/orders', { permissions: [] });
    await expect(page.getByText('لا تملك صلاحية عرض طلبات المتجر.')).toBeVisible();
    expect(requests.filter((r) => r.includes('/commerce/orders'))).toEqual([]);
  });

  test('server 403 shows a clear state', async ({ page }) => {
    await open(page, '/commerce/orders', { ordersStatus: 403 });
    await expect(page.getByText('لا تملك صلاحية عرض طلبات المتجر.').first()).toBeVisible();
  });
});
