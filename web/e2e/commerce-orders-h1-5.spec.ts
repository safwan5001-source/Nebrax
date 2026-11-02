import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H1-5 — قبول التاجر ورفضه ومرشّح حالة القبول في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن). الخادم مُعترَض بالكامل؛ لا خلفية.
 * يتحقق من: الاتجاه (RTL/LTR)، عدم تجاوز العرض الأفقي، إجراءات القبول/الرفض من العقد الاسترشادي وحده، منع الإرسال المكرر، وإرسال المرشّح للخادم.
 * اللقطات تُكتب فقط حين يُضبط `H15_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H15_SHOTS;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const sar = (m: number) => ({ amount_minor: m, currency: 'SAR' });

const channel = { sales_channel_id: 'c1', sales_channel_name: 'متجر الويب', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'زهور طيبة' };
const payment = { intent_id: 'i1', method: 'cod', status: 'awaiting_collection', payment_method_name: 'الدفع عند الاستلام', amount_minor: 11500, collected_at: null, paid_at: null, cancelled_at: null };
const awaiting = { mode: 'manual', effective_mode: 'manual', accepted_at: null };
const summary = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID, number: 'CORD-100', status: 'confirmed', lifecycle_status: 'confirmed', operational_status: 'awaiting_acceptance', acceptance: awaiting,
  cancellation: { cancelled: false, at: null, reason: null },
  created_at: '2026-11-02T10:00:00+03:00', confirmed_at: '2026-11-02T10:00:00+03:00',
  total: sar(11500), items_count: 2, delivery_method: 'standard', customer: { name: 'سارة العتيبي', phone: '0500000001' }, channel, payment, ...over,
});
const detailBase = {
  ...summary(), partner_id: null, delivery_amount: sar(1500),
  contact: { name: 'سارة العتيبي', company: null, email: 'sara@example.test', phone: '0500000001', vat_number: null, cr_number: null },
  shipping_address: { recipient_name: 'منى', phone: '0500000002', country: 'SA', region: 'الشرقية', city: 'الدمام', district: 'الشاطئ', street: 'شارع الخليج', building_no: '1234', additional_number: null, postal_code: '32415', notes: null },
  billing_address: null, gift: null, schedule: null,
  items: [{ id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'باقة ورد جوري', variant: null, unit_name: null, quantity: 2, unit_price: sar(5000), line_total: sar(10000), personalization: [] }],
  payment: { ...payment, collection_note: null, attempts: [] },
  accounting: { posted: false },
  accept_action: { available: true, blocked_reason: null },
  reject_action: { available: true, blocked_reason: null },
  cancel_action: { available: true, blocked_reason: null },
};
const accepted = {
  ...detailBase, operational_status: 'accepted',
  acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: '2026-11-02T10:30:00+03:00', by: { id: 'u1', name: 'المشرف' } },
  accept_action: { available: false, blocked_reason: 'already_accepted' }, reject_action: { available: false, blocked_reason: 'already_accepted' },
};
const rejected = {
  ...detailBase, lifecycle_status: 'cancelled', operational_status: 'cancelled',
  cancellation: { cancelled: true, at: '2026-11-02T10:40:00+03:00', reason: 'merchant_rejected', note: 'خارج نطاق التوصيل', by: { id: 'u1', name: 'المشرف' } },
  payment: { ...detailBase.payment, status: 'cancelled', cancelled_at: '2026-11-02T10:40:00+03:00' },
  accept_action: { available: false, blocked_reason: 'already_cancelled' }, reject_action: { available: false, blocked_reason: 'already_cancelled' }, cancel_action: { available: false, blocked_reason: 'already_cancelled' },
};

async function open(page: Page, path: string, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; detail?: unknown; accept?: (route: Route) => Promise<void> | void; reject?: (route: Route) => Promise<void> | void } = {}) {
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
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts', domains: [] }] } });
    if (p === '/commerce/orders') {
      return json(route, {
        data: [
          summary(),
          summary({ id: '22222222-2222-4222-8222-222222222222', number: 'CORD-101', operational_status: 'accepted', acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: '2026-11-02T10:30:00+03:00' }, total: sar(32000) }),
          summary({ id: '33333333-3333-4333-8333-333333333333', number: 'CORD-102', lifecycle_status: 'cancelled', operational_status: 'cancelled', cancellation: { cancelled: true, at: '2026-11-02T10:40:00+03:00', reason: 'merchant_rejected' } }),
        ],
        meta: { current_page: 1, per_page: 20, total: 3, last_page: 1 },
      });
    }
    if (p === `/commerce/orders/${ORDER_ID}/accept` && method === 'POST') return opts.accept ? opts.accept(route) : json(route, { data: accepted });
    if (p === `/commerce/orders/${ORDER_ID}/reject` && method === 'POST') return opts.reject ? opts.reject(route) : json(route, { data: rejected });
    if (p === `/commerce/orders/${ORDER_ID}`) return json(route, { data: opts.detail ?? detailBase });
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
const writes = (requests: string[]) => requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r));

test.describe('H1-5 merchant acceptance UI', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`list shows acceptance badges and the filter (${locale}), RTL/LTR and no overflow`, async ({ page }, info) => {
      const requests = await open(page, '/commerce/orders', { locale });
      await expect(shown(page, 'CORD-100')).toBeVisible();
      const dir = await page.evaluate(() => document.documentElement.dir);
      expect(dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByLabel(locale === 'ar' ? 'حالة القبول' : 'Acceptance status').locator('visible=true').first()).toBeVisible();
      await expect(shown(page, locale === 'ar' ? 'مرفوض' : 'Rejected')).toBeVisible();
      await expect(shown(page, locale === 'ar' ? 'مقبول' : 'Accepted')).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `list-${locale}-${info.project.name}`);
      expect(writes(requests)).toEqual([]);
    });
  }

  test('the filter and the quick chip send acceptance_status to the server', async ({ page }) => {
    const requests = await open(page, '/commerce/orders');
    await expect(shown(page, 'CORD-100')).toBeVisible();
    await page.getByRole('button', { name: 'بانتظار القبول' }).click();
    await expect.poll(() => requests.some((r) => r.includes('acceptance_status=awaiting_acceptance'))).toBe(true);
    await expect(page).toHaveURL(/acceptance_status=awaiting_acceptance/);
    await page.getByLabel('حالة القبول').selectOption('accepted');
    await expect.poll(() => requests.some((r) => r.includes('acceptance_status=accepted'))).toBe(true);
  });

  test('list in the dark theme has no overflow', async ({ page }, info) => {
    await open(page, '/commerce/orders', { theme: 'dark' });
    await expect(shown(page, 'CORD-100')).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `list-dark-${info.project.name}`);
  });

  test('detail offers accept and reject (no plain cancel), accepting sends one POST and shows the result', async ({ page }, info) => {
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`);
    await expect(page.getByRole('heading', { name: 'CORD-100' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'رفض الطلب' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إلغاء الطلب' })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `detail-awaiting-ar-${info.project.name}`);

    await page.getByRole('button', { name: 'قبول الطلب' }).dblclick();
    await expect(page.getByRole('status').filter({ hasText: 'تم قبول الطلب.' })).toBeVisible();
    expect(writes(requests)).toEqual([`POST /commerce/orders/${ORDER_ID}/accept`]);
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'إلغاء الطلب' })).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `detail-accepted-ar-${info.project.name}`);
  });

  test('a slow accept is protected against double submission in the real DOM', async ({ page }) => {
    let hits = 0;
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`, {
      accept: async (route) => {
        hits += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: accepted }) });
      },
    });
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toBeVisible();
    const button = page.getByRole('button', { name: 'قبول الطلب' });
    await button.click();
    await button.click({ force: true, noWaitAfter: true }).catch(() => undefined);
    await expect(page.getByRole('status').filter({ hasText: 'تم قبول الطلب.' })).toBeVisible();
    expect(hits).toBe(1);
    expect(writes(requests)).toHaveLength(1);
  });

  test('rejecting goes through a confirm dialog and posts the trimmed note once', async ({ page }, info) => {
    let body: unknown = null;
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`, {
      reject: async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rejected }) });
      },
    });
    await page.getByRole('button', { name: 'رفض الطلب' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `reject-dialog-ar-${info.project.name}`);
    await dialog.getByLabel(/ملاحظة للرفض/).fill('  خارج نطاق التوصيل  ');
    await dialog.getByRole('button', { name: 'تأكيد الرفض' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم رفض الطلب.' })).toBeVisible();
    expect(body).toEqual({ note: 'خارج نطاق التوصيل' });
    expect(writes(requests)).toEqual([`POST /commerce/orders/${ORDER_ID}/reject`]);
    await expect(page.getByText('رفض التاجر').locator('visible=true').first()).toBeVisible();
    await shot(page, `detail-rejected-ar-${info.project.name}`);
  });

  test('a 409 race refreshes to the real state and removes the stale action', async ({ page }) => {
    let served = 0;
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`, {
      accept: (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'x', reason: 'already_cancelled' }) }),
    });
    await page.route(`**/api/commerce/orders/${ORDER_ID}`, (route) => {
      served += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: served === 1 ? detailBase : rejected }) });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toBeVisible();
    await page.getByRole('button', { name: 'قبول الطلب' }).click();
    await expect(page.getByText(/تغيّرت حالة الطلب ولم يعد هذا الإجراء متاحاً/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toHaveCount(0);
    expect(writes(requests).length).toBeGreaterThanOrEqual(1);
  });

  test('without the manage permission no acceptance action is rendered', async ({ page }) => {
    const requests = await open(page, `/commerce/orders/${ORDER_ID}`, { permissions: ['commerce.orders.view'] });
    await expect(page.getByRole('heading', { name: 'CORD-100' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'قبول الطلب' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'رفض الطلب' })).toHaveCount(0);
    expect(writes(requests)).toEqual([]);
  });

  test('detail in English LTR (dark) renders the actions and no overflow', async ({ page }, info) => {
    await open(page, `/commerce/orders/${ORDER_ID}`, { locale: 'en', theme: 'dark' });
    await expect(page.getByRole('button', { name: 'Accept order' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject order' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    await noHorizontalOverflow(page);
    await shot(page, `detail-awaiting-en-dark-${info.project.name}`);
  });
});
