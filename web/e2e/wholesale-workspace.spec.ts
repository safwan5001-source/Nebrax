import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Wholesale Merchant Workspace — real-browser QA (desktop 1440 + phone 390, ar/en, light/dark). The API is fully
 * intercepted with QA fixtures that exist ONLY in this spec (never in production code); no backend runs. Two
 * scenarios: `dark` = deployment switch off (the shipped default → data sections show an honest gate) and
 * `active` = switch on + channel marked (what an activated tenant would see). Screenshots are written only when
 * `WHOLESALE_SHOTS` points to a folder.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.WHOLESALE_SHOTS;
const CH = 'c1111111-1111-4111-8111-111111111111';
const sar = (m: number) => ({ amount_minor: m, currency: 'SAR' });

type Scenario = 'dark' | 'active';

const channelSettings = (scenario: Scenario) => ({
  id: CH, name: 'متجر الجملة', type: 'web',
  default_price_list: { id: 'pl1', name: 'جملة — فئة أ', is_active: true },
  wholesale_membership_enabled: scenario === 'active',
  wholesale_deployment_enabled: scenario === 'active',
  recent_changes: scenario === 'active' ? [{ at: '2026-10-20T10:00:00+03:00', actor: { id: 'u1', name: 'Safwan' }, changes: { default_price_list_id: { from: null, to: 'pl1' } } }] : [],
});
const membership = (n: number, status: string) => ({
  id: `m${n}`, sales_channel_id: CH, status, applied_at: '2026-10-2' + n + 'T09:00:00+03:00', decided_at: status === 'pending' ? null : '2026-10-25T09:00:00+03:00',
  decided_by: status === 'pending' ? null : { id: 'u1', name: 'Safwan' }, decision_note: null,
  customer: { id: `i${n}`, display_name: ['شركة النخبة للتجارة', 'مؤسسة الرياض', 'Gulf Foods Co.', 'بقالة الواحة'][n % 4], email: `buyer${n}@example.test`, phone: '05000000' + n + n },
});
const order = (n: number, over: Record<string, unknown> = {}) => ({
  id: `0000000${n}-1111-4111-8111-111111111111`, number: `CORD-20${n}`, status: 'confirmed', lifecycle_status: 'confirmed',
  created_at: '2026-10-2' + n + 'T10:00:00+03:00', confirmed_at: '2026-10-2' + n + 'T10:00:00+03:00', total: sar(n * 123400), items_count: n + 1,
  delivery_method: 'standard', customer: { name: 'شركة النخبة للتجارة', phone: '0500000001' },
  channel: { sales_channel_id: CH, sales_channel_name: 'متجر الجملة', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'متجر الجملة' },
  payment: { intent_id: 'i1', method: 'cod', status: 'awaiting_collection', payment_method_name: 'الدفع عند الاستلام', amount_minor: n * 123400, collected_at: null, paid_at: null, cancelled_at: null },
  ...over,
});

const consoleErrors: string[] = [];

async function open(page: Page, path: string, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; scenario?: Scenario; permissions?: string[] } = {}) {
  const locale = opts.locale ?? 'ar';
  const scenario = opts.scenario ?? 'active';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  page.on('console', (message) => {
    // Pre-existing dev-only next-intl INVALID_KEY noise from `appBuilder.builder.visibility.*` message keys (present on
    // every page of the app, unrelated to this workspace) is excluded; every other console error fails the spec.
    if (message.type() === 'error' && !/INVALID_KEY|appBuilder\.builder\.visibility|Server\s+Error: INVALID_KEY/.test(message.text())) {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}${url.search}`);
    const status = url.searchParams.get('status');
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'متجر الجملة', sales_channel_id: CH, is_active: true, default_locale: 'ar', business_vertical: 'general', domains: [] }] } });
    if (p === `/commerce/channels/${CH}/pricing-settings`) return json(route, { data: channelSettings(scenario) });
    if (p === `/commerce/wholesale/channels/${CH}/memberships`) {
      const rows = status === 'pending' ? [membership(1, 'pending'), membership(2, 'pending')] : status === 'approved' ? [membership(3, 'approved')] : status ? [] : [membership(1, 'pending'), membership(2, 'pending'), membership(3, 'approved'), membership(4, 'suspended')];
      const total = status === 'approved' ? 14 : status === 'suspended' ? 1 : rows.length;
      return json(route, { data: rows, meta: { page: 1, per_page: 25, total, last_page: 1 } });
    }
    if (p === '/commerce/orders') return json(route, { data: [order(1), order(2, { payment: { ...order(2).payment, method: 'online', status: 'paid', payment_method_name: 'مدى' } }), order(3)], meta: { current_page: 1, per_page: 20, total: 37, last_page: 2 } });
    if (p.startsWith('/commerce/orders/')) return json(route, { data: { ...order(1), cancel_action: { available: true, blocked_reason: null }, partner_id: null, delivery_amount: sar(0), contact: { name: 'شركة النخبة للتجارة', company: 'شركة النخبة للتجارة', email: 'buyer@example.test', phone: '0500000001', vat_number: '300000000000003', cr_number: '1010000000' }, shipping_address: null, billing_address: null, gift: null, schedule: null, items: [{ id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'أرز بسمتي 10 كجم', variant: null, unit_name: 'كرتون', quantity: 20, unit_price: sar(5000), line_total: sar(100000), personalization: [] }], payment: { ...order(1).payment, collection_note: null, attempts: [] }, accounting: { posted: false } } });
    if (p === '/price-lists') return json(route, { data: [{ id: 'pl1', name: 'جملة — فئة أ', description: 'أسعار الجملة للمشترين المعتمدين', is_active: true, items_count: 42 }, { id: 'pl2', name: 'تصفية الموسم', description: null, is_active: false, items_count: 0 }] });
    if (p === '/commerce/workspace/products/publication') return json(route, { data: [{ id: 'p1', sku: 'RICE-10', name: 'أرز بسمتي 10 كجم', name_en: 'Basmati rice 10 kg', is_active: true, is_published: true, stores: [{ id: 's1', name: 'متجر الجملة', is_published: true }] }, { id: 'p2', sku: 'OIL-18', name: 'زيت طبخ 18 لتر', name_en: null, is_active: true, is_published: false, stores: [{ id: 's1', name: 'متجر الجملة', is_published: false }] }], meta: { current_page: 1, last_page: 1, per_page: 10, total: 2 } });
    if (p === '/quotes') return json(route, { data: [{ id: 'q1', number: 'QT-0001', partner_id: 'pa1', status: 'sent', quote_date: '2026-10-20', valid_until: '2026-11-20', total: '4600.00' }] });
    if (p === '/payment-methods') return json(route, { data: [{ id: 'pm1', name: 'نقدي', settlement_type: 'cash', cash_bank_account_name: 'الخزينة الرئيسية', available_online: false, is_active: true, is_default: true }, { id: 'pm2', name: 'تحويل بنكي', settlement_type: 'bank', cash_bank_account_name: 'الحساب الرئيسي', available_online: false, is_active: true, is_default: false }] });
    if (p === '/partners') return json(route, { data: [{ id: 'pa1', name: 'شركة النخبة للتجارة', code: 'C-001', type: 'customer', credit_limit: '50000.00', credit_period: 30, is_active: true }], meta: { current_page: 1, last_page: 1, per_page: 100, total: 1 } });
    if (url.searchParams.get('per_page') === '1' && p.startsWith('/commerce/')) return json(route, { data: [], meta: { current_page: 1, per_page: 1, total: 12, last_page: 12 } });
    return json(route, { data: [] });
  });
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
  const { overflow, culprits } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1 || el.getBoundingClientRect().left < -1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { overflow: document.documentElement.scrollWidth - width, culprits: wide };
  });
  expect(overflow, `overflowing elements: ${culprits.join(' | ')}`).toBeLessThanOrEqual(0);
};

const SECTIONS = [
  ['overview', ''], ['orders', '/orders'], ['buyers', '/buyers'], ['catalog', '/catalog'], ['price-lists', '/price-lists'],
  ['offers', '/offers'], ['quotations', '/quotations'], ['shipping', '/shipping'], ['payments', '/payments'],
  ['reports', '/reports'], ['settings', '/settings'],
] as const;

test.describe('Wholesale workspace', () => {
  test.beforeEach(() => {
    consoleErrors.length = 0;
  });

  for (const locale of ['ar', 'en'] as const) {
    for (const [name, suffix] of SECTIONS) {
      test(`${name} renders active (${locale}) without overflow and without unexpected writes`, async ({ page }, info) => {
        const requests = await open(page, `/commerce/wholesale${suffix}`, { locale, scenario: 'active' });
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await noHorizontalOverflow(page);
        await shot(page, `${name}-active-${locale}-${info.project.name}`);
        expect(requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r))).toEqual([]);
        expect(requests.join('\n')).not.toContain('tenant_id');
        expect(consoleErrors, 'browser console errors').toEqual([]);
      });
    }
  }

  test('deployment switch off: data sections are gated and send no wholesale data request', async ({ page }, info) => {
    const requests = await open(page, '/commerce/wholesale/buyers', { scenario: 'dark' });
    await expect(page.getByText('الجملة غير مفعّلة في هذا النشر').first()).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `buyers-gated-ar-${info.project.name}`);
    expect(requests.filter((r) => r.includes('/memberships') || r.startsWith('GET /commerce/orders'))).toEqual([]);
  });

  test('overview in dark mode (deployment off) and English', async ({ page }, info) => {
    await open(page, '/commerce/wholesale', { scenario: 'dark', theme: 'dark', locale: 'en' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
    await shot(page, `overview-gated-en-dark-${info.project.name}`);
  });

  test('without any permission nothing wholesale is requested', async ({ page }) => {
    const requests = await open(page, '/commerce/wholesale/buyers', { permissions: [] });
    await page.waitForLoadState('networkidle');
    expect(requests.filter((r) => r.includes('/memberships') || r.includes('/commerce/orders') || r.includes('pricing-settings'))).toEqual([]);
  });

  test('buyer decision drawer works with the keyboard', async ({ page }, info) => {
    await open(page, '/commerce/wholesale/buyers');
    await expect(page.getByText('مؤسسة الرياض').filter({ visible: true }).first()).toBeVisible();
    const details = page.getByRole('button', { name: 'تفاصيل' }).filter({ visible: true }).first();
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, `buyers-drawer-ar-${info.project.name}`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
