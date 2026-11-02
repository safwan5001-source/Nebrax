import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H2-3 — واجهة تنفيذ الطلب في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن). الخادم مُعترَض بالكامل؛ لا خلفية.
 * يتحقق من: الإجراءات من العقد الاسترشادي وحده، الاتجاه، عدم تجاوز العرض الأفقي، منع الإرسال المكرر، قفل الحالة القديمة بعد 409،
 * نص الفشل الثابت (AR-1) بلا أي زر إغلاق/إلغاء/استرداد، وإرسال مرشّح الحالة للخادم. اللقطات تُكتب فقط حين يُضبط `H23_SHOTS`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H23_SHOTS;
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const sar = (m: number) => ({ amount_minor: m, currency: 'SAR' });

const channel = { sales_channel_id: 'c1', sales_channel_name: 'متجر الويب', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'زهور طيبة' };
const payment = { intent_id: 'i1', method: 'cod', status: 'awaiting_collection', payment_method_name: 'الدفع عند الاستلام', amount_minor: 11500, collected_at: null, paid_at: null, cancelled_at: null };
const summary = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID, number: 'CORD-100', status: 'confirmed', lifecycle_status: 'confirmed', operational_status: 'accepted',
  cancellation: { cancelled: false, at: null, reason: null },
  created_at: '2026-11-02T10:00:00+03:00', confirmed_at: '2026-11-02T10:00:00+03:00',
  total: sar(11500), items_count: 2, delivery_method: 'standard', customer: { name: 'سارة العتيبي', phone: '0500000001' }, channel, payment, ...over,
});
const block = (over: Record<string, unknown> = {}) => ({
  status: 'preparing', type: 'local_delivery', version: 1, warehouse: { id: 'w1', name: 'مخزن الدمام' },
  carrier: { name: null, tracking_number: null, tracking_url: null }, courier: { name: null, phone: null },
  delivery_attempts: 0, last_failure: null, timestamps: { preparing_at: '2026-11-02T09:00:00+03:00' }, ...over,
});
const detailBase = {
  ...summary(), partner_id: null, delivery_amount: sar(1500),
  contact: { name: 'سارة العتيبي', company: null, email: 'sara@example.test', phone: '0500000001', vat_number: null, cr_number: null },
  shipping_address: { recipient_name: 'منى', phone: '0500000002', country: 'SA', region: 'الشرقية', city: 'الدمام', district: 'الشاطئ', street: 'شارع الخليج', building_no: '1234', additional_number: null, postal_code: '32415', notes: null },
  billing_address: null, gift: null, schedule: null,
  items: [{ id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'باقة ورد جوري', variant: null, unit_name: null, quantity: 2, unit_price: sar(5000), line_total: sar(10000), personalization: [] }],
  payment: { ...payment, collection_note: null, attempts: [] },
  accounting: { posted: false },
  cancel_action: { available: true, blocked_reason: null },
};
const act = (...names: string[]) => names.map((action) => ({ action, available: true, blocked_reason: null }));
const notStarted = { ...detailBase, fulfillment_actions: act('start', 'mark_ready') };
const preparing = { ...detailBase, operational_status: 'preparing', fulfillment: block(), fulfillment_actions: act('mark_ready') };
const ready = { ...detailBase, operational_status: 'ready', fulfillment: block({ status: 'ready', version: 2 }), fulfillment_actions: act('dispatch', 'pickup') };
const failed = {
  ...detailBase, operational_status: 'delivery_failed',
  fulfillment: block({ status: 'delivery_failed', version: 4, delivery_attempts: 1, last_failure: { reason: 'address_issue', note: 'العنوان غير صحيح', at: '2026-11-02T12:00:00+03:00' } }),
  fulfillment_actions: act('dispatch', 'return'), cancel_action: { available: false, blocked_reason: 'fulfillment_in_transit' },
};
const outForDelivery = { ...detailBase, operational_status: 'out_for_delivery', fulfillment: block({ status: 'out_for_delivery', version: 3 }), fulfillment_actions: act('deliver', 'fail'), cancel_action: { available: false, blocked_reason: 'fulfillment_in_transit' } };

type Opts = { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; detail?: unknown; detailFn?: () => unknown; act?: (route: Route, action: string) => Promise<void> | void };
async function open(page: Page, path: string, opts: Opts = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'] };
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
          summary({ fulfillment: { status: 'preparing', type: 'local_delivery' } }),
          summary({ id: '22222222-2222-4222-8222-222222222222', number: 'CORD-101', fulfillment: { status: 'delivery_failed', type: 'carrier' }, total: sar(32000) }),
          summary({ id: '33333333-3333-4333-8333-333333333333', number: 'CORD-102' }),
        ],
        meta: { current_page: 1, per_page: 20, total: 3, last_page: 1 },
      });
    }
    const m = p.match(new RegExp(`^/commerce/orders/${ORDER_ID}/fulfillment/([a-z_]+)$`));
    if (m && method === 'POST') return opts.act ? opts.act(route, m[1]) : json(route, { data: preparing });
    if (p === `/commerce/orders/${ORDER_ID}`) return json(route, { data: opts.detailFn ? opts.detailFn() : opts.detail ?? notStarted });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shown = (page: Page, text: string) => page.getByText(text).locator('visible=true').first();
const writes = (requests: string[]) => requests.filter((r) => /^(POST|PUT|PATCH|DELETE) /.test(r));
const detailPath = `/commerce/orders/${ORDER_ID}`;
/** على الجوال أقسام التفاصيل أكورديون مطويّ؛ نفتح قسم التنفيذ إن كان مطوياً (سطح المكتب مفتوح). */
async function expandFulfillment(page: Page, locale: 'ar' | 'en' = 'ar') {
  await expect(page.getByRole('heading', { name: 'CORD-100' })).toBeVisible();
  const toggle = page.getByRole('button', { name: locale === 'ar' ? 'التنفيذ' : 'Fulfillment', exact: true });
  // سطح المكتب: القسم مفتوح بلا زرّ طيّ؛ الجوال: أكورديون.
  if ((await toggle.count()) > 0 && (await toggle.first().isVisible()) && (await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
}

test.describe('H2-3 staff fulfillment UI', () => {
  for (const locale of ['ar', 'en'] as const) {
    test(`list shows the fulfillment badge and filter (${locale}), RTL/LTR and no overflow`, async ({ page }, info) => {
      const requests = await open(page, '/commerce/orders', { locale });
      await expect(shown(page, 'CORD-100')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.getByLabel(locale === 'ar' ? 'حالة التنفيذ' : 'Fulfillment status').locator('visible=true').first()).toBeVisible();
      await expect(shown(page, locale === 'ar' ? 'قيد التحضير' : 'Preparing')).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `list-${locale}-${info.project.name}`);
      expect(writes(requests)).toEqual([]);
    });
  }

  test('the filter sends fulfillment_status to the server', async ({ page }) => {
    const requests = await open(page, '/commerce/orders');
    await expect(shown(page, 'CORD-100')).toBeVisible();
    await page.getByLabel('حالة التنفيذ').locator('visible=true').first().selectOption('not_started');
    await expect.poll(() => requests.some((r) => r.includes('fulfillment_status=not_started'))).toBe(true);
    await expect(page).toHaveURL(/fulfillment_status=not_started/);
  });

  test('detail offers only the contract actions; starting sends one POST with expected_version', async ({ page }, info) => {
    let body: unknown = null;
    const requests = await open(page, detailPath, {
      act: async (route, action) => {
        body = { action, ...(route.request().postDataJSON() as object) };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: preparing }) });
      },
    });
    await expandFulfillment(page);
    await expect(page.getByRole('button', { name: 'بدء التحضير' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تم التسليم' })).toHaveCount(0);
    await expect(shown(page, 'تنفيذ تشغيلي')).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `detail-not-started-ar-${info.project.name}`);
    await page.getByRole('button', { name: 'بدء التحضير' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم تحديث حالة التنفيذ.' })).toBeVisible();
    expect(body).toMatchObject({ action: 'start' });
    expect(writes(requests)).toEqual([`POST ${detailPath}/fulfillment/start`]);
  });

  test('a slow action is protected against double submission in the real DOM', async ({ page }) => {
    let hits = 0;
    const requests = await open(page, detailPath, {
      detail: preparing,
      act: async (route) => {
        hits += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: ready }) });
      },
    });
    await expandFulfillment(page);
    await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'جاهز', exact: true }).evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    await expect(page.getByRole('status').filter({ hasText: 'تم تحديث حالة التنفيذ.' })).toBeVisible();
    expect(hits).toBe(1);
    expect(writes(requests)).toHaveLength(1);
  });

  test('a 409 race refreshes to the server state and removes the stale action', async ({ page }) => {
    let raced = false;
    const requests = await open(page, detailPath, {
      detail: preparing,
      detailFn: () => (raced ? ready : preparing),
      act: (route) => {
        raced = true;
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'x', reason: 'fulfillment_version_conflict', current_version: 2, current_status: 'ready' }) });
      },
    });
    await expandFulfillment(page);
    await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'جاهز', exact: true }).click();
    await expect(page.getByText(/تغيّرت حالة التنفيذ منذ آخر قراءة/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'إرسال للتوصيل' })).toBeVisible();
    expect(writes(requests)).toEqual([`POST ${detailPath}/fulfillment/mark_ready`]);
  });

  test('delivery failure shows the fixed AR-1 text and never offers close, cancel-order or refund', async ({ page }, info) => {
    await open(page, detailPath, { detail: failed });
    await expandFulfillment(page);
    await expect(shown(page, 'لا يتوفر في هذه النسخة إغلاق')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إرسال للتوصيل' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'عاد للمتجر' })).toBeVisible();
    for (const name of [/إلغاء الطلب/, /إغلاق الطلب/, /استرداد/, /شطب/]) await expect(page.getByRole('button', { name })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `detail-failed-ar-${info.project.name}`);
  });

  test('the failure dialog requires a reason and posts it once', async ({ page }, info) => {
    let body: Record<string, unknown> | null = null;
    const requests = await open(page, detailPath, {
      detail: outForDelivery,
      act: async (route) => {
        body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: failed }) });
      },
    });
    await expandFulfillment(page);
    await page.getByRole('button', { name: 'تعذّر التسليم' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `fail-dialog-ar-${info.project.name}`);
    await dialog.getByLabel('سبب تعذّر التسليم').selectOption('address_issue');
    await dialog.getByRole('button', { name: 'تسجيل تعذّر التسليم' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تم تحديث حالة التنفيذ.' })).toBeVisible();
    expect(body).toMatchObject({ reason: 'address_issue', expected_version: 3 });
    expect(writes(requests)).toEqual([`POST ${detailPath}/fulfillment/fail`]);
  });

  test('without the manage permission or without the contract no action is rendered', async ({ page }) => {
    const requests = await open(page, detailPath, { permissions: ['commerce.orders.view'], detail: preparing });
    await expandFulfillment(page);
    await expect(page.getByRole('button', { name: 'جاهز', exact: true })).toHaveCount(0);
    await expect(shown(page, 'قيد التحضير')).toBeVisible();
    expect(writes(requests)).toEqual([]);
  });

  test('English LTR dark renders the actions with no overflow', async ({ page }, info) => {
    await open(page, detailPath, { locale: 'en', theme: 'dark', detail: notStarted });
    await expandFulfillment(page, 'en');
    await expect(page.getByRole('button', { name: 'Start preparing' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    await noHorizontalOverflow(page);
    await shot(page, `detail-not-started-en-dark-${info.project.name}`);
  });
});
