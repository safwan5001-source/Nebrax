import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H3-5 — مساحة استقبال الطلبات `/commerce/orders/live` في متصفح حقيقي (سطح مكتب 1440 + جوال 390 + لوحي 768، ar/en RTL/LTR، فاتح/داكن). الخادم مُعترَض بالكامل.
 * يتحقق من: الأعمدة من حقائق الخادم، تبويبات تحت xl، عدم تجاوز العرض الأفقي، أهداف لمس ≥ 44px، بوابة التنبيه المغلقة، عدم وجود استطلاع خاص باللوحة،
 * إعادة الجلب عند حدث تغذية، القبول والإقرار (POST واحد)، Wake Lock وملء الشاشة. اللقطات تُكتب فقط حين يُضبط `H35_SHOTS`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H35_SHOTS;

const sar = (minor: number) => ({ amount_minor: minor, currency: 'SAR' });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const ID = (n: number) => `0000000${n}-1111-4111-8111-111111111111`;

function summary(n: number, status: string, over: Record<string, unknown> = {}) {
  return {
    id: ID(n),
    number: `CORD-2026-0000${n}`,
    status: 'confirmed',
    lifecycle_status: 'confirmed',
    operational_status: status,
    acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: null },
    created_at: minutesAgo(n * 3),
    confirmed_at: minutesAgo(n * 3),
    total: sar(11500 + n * 100),
    items_count: 2,
    delivery_method: n % 2 === 0 ? 'pickup' : 'standard',
    customer: { name: `عميلة ${n}`, phone: `05000000${n}` },
    channel: { sales_channel_id: 'c1', sales_channel_name: 'متجر الويب', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'زهور طيبة' },
    payment: { intent_id: `i${n}`, method: 'cod', status: 'awaiting_collection', payment_method_name: null, amount_minor: 11500, collected_at: null, paid_at: null, cancelled_at: null },
    schedule: null,
    ...over,
  };
}

const ROWS: Record<string, unknown[]> = {
  'not_started:awaiting_collection': [
    summary(1, 'awaiting_acceptance', { schedule: { method: 'delivery', date: '2026-11-04', slot: { label: 'مساءً', label_en: 'Evening', start_time: '17:00', end_time: '20:00' }, timezone: 'Asia/Riyadh' } }),
    summary(2, 'accepted', { acceptance: { mode: 'auto', effective_mode: 'auto', accepted_at: null } }),
  ],
  preparing: [summary(3, 'preparing', { fulfillment: { status: 'preparing', type: 'local_delivery' } })],
  ready: [summary(4, 'ready', { fulfillment: { status: 'ready', type: 'pickup' }, delivery_method: 'pickup' })],
  out_for_delivery: [summary(5, 'out_for_delivery', { fulfillment: { status: 'out_for_delivery', type: 'local_delivery' } })],
  delivered: [summary(6, 'delivered', { fulfillment: { status: 'delivered', type: 'local_delivery' } })],
};

const detail = (n: number, accepted = false) => ({
  ...summary(n, accepted ? 'accepted' : 'awaiting_acceptance', accepted ? { acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: minutesAgo(0) } } : {}),
  partner_id: null,
  delivery_amount: sar(1500),
  contact: { name: `عميلة ${n}`, company: null, email: null, phone: `05000000${n}`, vat_number: null, cr_number: null },
  shipping_address: { city: 'الدمام', district: 'الشاطئ', street: 'شارع الأمير' },
  billing_address: null,
  gift: null,
  schedule: null,
  items: [{ id: 'l1', parent_line_id: null, product_id: 'p1', product_variant_id: null, product_name: 'باقة ورد', variant: null, unit_name: null, quantity: 2, unit_price: sar(5000), line_total: sar(10000), personalization: [] }],
  payment: { ...summary(n, 'x').payment, collection_note: null, attempts: [] },
  accounting: { posted: false },
  timeline: [],
  ...(accepted ? {} : { accept_action: { available: true, blocked_reason: null }, reject_action: { available: true, blocked_reason: null } }),
});

type Opts = { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; enabled?: boolean; viewport?: { width: number; height: number }; wakeLock?: 'ok' | 'none' };

async function open(page: Page, opts: Opts = {}) {
  const locale = opts.locale ?? 'ar';
  if (opts.viewport) await page.setViewportSize(opts.viewport);
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const state = { feedCalls: 0, emitEventAt: 0 };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}${url.search}`);
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts', domains: [] }] } });
    if (p === '/commerce/alerts/config') return json(route, { data: { enabled: opts.enabled ?? true, mode: 'feed_attention', polling: { feed_ms: 1000, attention_ms: 60000, attention_only_ms: 15000 } } });
    if (p === '/commerce/orders/feed') {
      state.feedCalls += 1;
      const emit = state.emitEventAt > 0 && state.feedCalls >= state.emitEventAt;
      return json(route, {
        data: emit ? [{ seq: 6, type: 'order.placed', occurred_at: minutesAgo(0), order: { id: ID(9), number: 'CORD-9' } }] : [],
        meta: { after_seq: 5, next_after_seq: emit ? 6 : 5, has_more: false, limit: 100, head_seq: emit ? 6 : 5 },
      });
    }
    if (p === '/commerce/orders/attention') {
      return json(route, {
        data: [{ order: { id: ID(2), number: 'CORD-2026-00002', storefront_id: 's1', sales_channel_id: 'c1', delivery_method: 'standard', created_at: minutesAgo(6) }, payment: { method: 'cod', status: 'awaiting_collection' }, reasons: ['new_order'], alert: { pending: true } }],
        meta: { truncated: false, window_hours: 48, limit: 100 },
      });
    }
    if (method === 'POST' && /\/acknowledge$/.test(p)) return json(route, { data: { order_id: p.split('/')[3], acknowledged: true, acknowledged_at: minutesAgo(0), created: true } });
    if (method === 'POST' && /\/accept$/.test(p)) return json(route, { data: detail(1, true) });
    if (method === 'GET' && p === '/commerce/orders') {
      const f = url.searchParams.get('fulfillment_status') ?? '';
      const pay = url.searchParams.get('payment_status');
      const key = f === 'not_started' ? `not_started:${pay}` : f;
      const data = ROWS[key] ?? [];
      return json(route, { data, meta: { current_page: 1, per_page: 50, total: data.length, last_page: 1 } });
    }
    if (method === 'GET' && /^\/commerce\/orders\/[0-9a-f-]+$/.test(p)) {
      const n = Number(p.slice(-36, -35 - 0 + 0) || '1');
      return json(route, { data: detail(Number.isFinite(n) && n > 0 ? n : 1) });
    }
    if (p === '/notifications/unread-count') return json(route, { data: { count: 0 } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme, wake]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
    if (wake === 'ok') {
      const w = window as unknown as { __wakeRequests: number };
      w.__wakeRequests = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => { w.__wakeRequests += 1; const l = new EventTarget(); return Object.assign(l, { release: async () => { l.dispatchEvent(new Event('release')); } }); } },
      });
    } else if (wake === 'none') {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    }
  }, [JSON.stringify(user), opts.theme ?? 'light', opts.wakeLock ?? 'ok'] as const);
  await page.goto(`${baseUrl}/commerce/orders/live`, { waitUntil: 'domcontentloaded' });
  return { requests, state };
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const boardRequests = (requests: string[]) => requests.filter((r) => r.startsWith('GET /commerce/orders?'));
const card = (page: Page, n: number) => page.locator(`[data-testid="board-card"][data-order-id="${ID(n)}"]`);

for (const locale of ['ar', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${locale}/${theme}: الأعمدة من حقائق الخادم، الاتجاه، عدم تجاوز العرض، أهداف اللمس`, async ({ page }, info) => {
      await open(page, { locale, theme });
      await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 20_000 });
      expect(await page.locator('html').getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      const inCol = async (key: string) => page.locator(`[data-testid="board-col-${key}"] [data-testid="board-card"]`).count();
      // الطلب 2 مقبول تلقائياً وتنبيهه قائم (attention) ⇒ «جديد» مع الطلب 1.
      expect(await inCol('new')).toBe(2);
      expect(await inCol('accepted')).toBe(1);
      expect(await inCol('ready')).toBe(1);
      expect(await inCol('dispatch')).toBe(1);
      expect(await inCol('done')).toBe(1);
      await expect(card(page, 2).getByTestId('board-new-badge')).toBeVisible();
      await expect(card(page, 1).getByTestId('board-schedule')).toBeVisible();
      await expect(page.getByTestId('board-connection')).toContainText(locale === 'ar' ? 'متصل' : 'Connected');
      await noHorizontalOverflow(page);

      const width = page.viewportSize()!.width;
      if (width >= 1280) {
        // خمسة أعمدة ظاهرة معاً.
        for (const key of ['new', 'accepted', 'ready', 'dispatch', 'done']) await expect(page.getByTestId(`board-col-${key}`)).toBeVisible();
      } else {
        await expect(page.getByTestId('board-tab-new')).toBeVisible();
        await expect(page.getByTestId('board-col-ready')).toBeHidden();
        await page.getByTestId('board-tab-ready').click();
        await expect(page.getByTestId('board-col-ready')).toBeVisible();
        await page.getByTestId('board-tab-new').click();
      }

      // أهداف اللمس ≥ 44px للأزرار الرئيسية.
      for (const locator of [page.getByTestId('board-refresh'), page.getByTestId('board-wakelock'), page.getByTestId('board-fullscreen'), card(page, 2).getByTestId('board-card-ack')]) {
        const box = await locator.boundingBox();
        expect(box!.height, 'target height').toBeGreaterThanOrEqual(43.5);
      }
      await shot(page, `${info.project.name}-${locale}-${theme}-board`);
    });
  }
}

test('لوحي 768: تبويبات بلا تمرير أفقي وبطاقات في عمودين', async ({ page }) => {
  await open(page, { viewport: { width: 768, height: 1024 } });
  await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 20_000 });
  await noHorizontalOverflow(page);
  await expect(page.getByTestId('board-tab-new')).toBeVisible();
  await shot(page, 'tablet-768-ar-light-board');
});

test('بوابة التنبيه مغلقة: إشعار «غير مفعّل»، لا تغذية ولا انتباه، والطلبات تُقرأ يدوياً', async ({ page }) => {
  const { requests } = await open(page, { enabled: false });
  await expect(page.getByTestId('board-alerts-off')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('board-card')).toHaveCount(6);
  await page.waitForTimeout(2_500);
  expect(requests.some((r) => /orders\/(feed|attention)/.test(r))).toBe(false);
  const before = boardRequests(requests).length;
  await page.getByTestId('board-refresh').click();
  await expect.poll(() => boardRequests(requests).length).toBeGreaterThan(before);
  await shot(page, 'alerts-off');
});

test('لا استطلاع خاص باللوحة: بلا تغيّر لا جلب جديد، وحدث تغذية يعيد الجلب مرة', async ({ page }) => {
  const { requests, state } = await open(page);
  await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 20_000 });
  await page.waitForTimeout(3_500); // يستقر الإقلاع (الوضع الصارم في التطوير يضاعف الجلب الأول)
  const quiet = boardRequests(requests).length;
  expect(quiet % 10).toBe(0); // دفعات كاملة من عشر قراءات
  const feedBefore = state.feedCalls;
  await page.waitForTimeout(3_000); // ≥ 3 دورات تغذية (feed_ms=1000) بلا أي تغيّر
  expect(state.feedCalls).toBeGreaterThanOrEqual(feedBefore + 2);
  expect(boardRequests(requests).length).toBe(quiet); // لا مؤقّت ولا استطلاع خاص باللوحة
  state.emitEventAt = state.feedCalls + 1;
  await expect.poll(() => boardRequests(requests).length, { timeout: 15_000 }).toBeGreaterThan(quiet);
});

test('الإقرار من البطاقة: POST إقرار واحد فقط ولا يلمس غيره، وتنتقل البطاقة إلى «مقبول»', async ({ page }) => {
  const { requests } = await open(page);
  await expect(card(page, 2).getByTestId('board-card-ack')).toBeVisible({ timeout: 20_000 });
  await card(page, 2).getByTestId('board-card-ack').click();
  await expect(page.locator('[data-testid="board-col-new"] [data-testid="board-card"]')).toHaveCount(1);
  const writes = requests.filter((r) => !r.startsWith('GET'));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatch(/^POST \/commerce\/orders\/[0-9a-f-]+\/acknowledge$/);
});

test('القبول من لوحة الطلب: POST قبول واحد، والإجراء يختفي بعد القبول', async ({ page }, info) => {
  const { requests } = await open(page);
  await card(page, 1).getByRole('button').first().click({ timeout: 20_000 });
  await expect(page.getByTestId('reception-panel')).toBeVisible();
  await expect(page.getByTestId('panel-accept')).toBeVisible();
  await expect(page.getByTestId('panel-reject')).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, `${info.project.name}-panel`);
  await page.getByTestId('panel-accept').click();
  await expect(page.getByTestId('panel-accept')).toHaveCount(0);
  const writes = requests.filter((r) => !r.startsWith('GET'));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatch(/^POST \/commerce\/orders\/[0-9a-f-]+\/accept$/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reception-panel')).toHaveCount(0);
});

test('Wake Lock: لا طلب تلقائي، النقر يطلب القفل ويُظهر الحالة، والنقر الثاني يوقفه', async ({ page }) => {
  await open(page, { wakeLock: 'ok' });
  await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __wakeRequests: number }).__wakeRequests)).toBe(0);
  await page.getByTestId('board-wakelock').click();
  await expect(page.getByTestId('board-screen-note')).toContainText(/مضاءة|on/i);
  expect(await page.evaluate(() => (window as unknown as { __wakeRequests: number }).__wakeRequests)).toBe(1);
  await expect(page.getByTestId('board-wakelock')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('board-wakelock').click();
  await expect(page.getByTestId('board-wakelock')).toHaveAttribute('aria-pressed', 'false');
});

test('Wake Lock غير مدعوم: زر معطّل ونص صريح بلا ادّعاء', async ({ page }) => {
  await open(page, { wakeLock: 'none' });
  await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 20_000 });
  await expect(page.getByTestId('board-wakelock')).toBeDisabled();
  await expect(page.getByTestId('board-screen-note')).toContainText('لا يدعم');
});

test('شريط الصوت: تفعيل بنقرة يغيّر الحالة، ونصا الموثوقية الملزمان ظاهران', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('board-sound-enable')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reception-board').getByText(/قد يتأخر التنبيه أو لا يصل/)).toBeVisible();
  await expect(page.getByTestId('alert-sound-bar')).toHaveCount(0); // لا شريط ثانٍ فوق مساحة الاستقبال
  await page.getByTestId('board-sound-enable').click();
  await expect(page.getByTestId('board-sound-enable')).toHaveCount(0);
});
