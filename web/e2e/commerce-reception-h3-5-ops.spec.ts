import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * COPS-H3-5 — سلوك التشغيل في متصفح حقيقي: الصوت (يتكرر حتى الإقرار ثم يتوقف)، تبادل القيادة بين تبويبين، والإقرار عبر جهازين (سياقان معزولان).
 * الخادم مُعترَض بحالة مشتركة بين الصفحات. **لا يُثبت** تسليماً في الخلفية ولا على جوال مقفل ولا مخرجاً صوتياً حقيقياً (headless): ما يُقاس هو استدعاءات
 * `HTMLMediaElement.play` فقط. الفحص على جهاز حقيقي موثَّق في التقرير النهائي (قائمة iPhone).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const ORDER = '00000002-1111-4111-8111-111111111111';

type Shared = { acked: boolean; seq: number; events: { seq: number; type: string }[]; acks: number };
const newShared = (): Shared => ({ acked: false, seq: 5, events: [], acks: 0 });

const sar = (minor: number) => ({ amount_minor: minor, currency: 'SAR' });
const row = () => ({
  id: ORDER, number: 'CORD-2026-00002', status: 'confirmed', lifecycle_status: 'confirmed', operational_status: 'accepted',
  acceptance: { mode: 'auto', effective_mode: 'auto', accepted_at: null }, created_at: new Date(Date.now() - 60_000).toISOString(),
  confirmed_at: new Date(Date.now() - 60_000).toISOString(), total: sar(11700), items_count: 2, delivery_method: 'standard',
  customer: { name: 'عميلة 2', phone: '0500000002' },
  channel: { sales_channel_id: 'c1', sales_channel_name: 'متجر الويب', sales_channel_type: 'web', storefront_id: 's1', storefront_name: 'زهور طيبة' },
  payment: { intent_id: 'i2', method: 'cod', status: 'awaiting_collection', payment_method_name: null, amount_minor: 11700, collected_at: null, paid_at: null, cancelled_at: null },
  schedule: null,
});

async function device(context: BrowserContext, shared: Shared) {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts', domains: [] }] } });
    if (p === '/commerce/alerts/config') return json(route, { data: { enabled: true, mode: 'feed_attention', polling: { feed_ms: 1000, attention_ms: 60000, attention_only_ms: 15000 } } });
    if (p === '/commerce/orders/feed') {
      const after = Number(url.searchParams.get('after_seq') ?? shared.seq);
      const events = shared.events.filter((e) => e.seq > after).map((e) => ({ ...e, occurred_at: null, order: { id: ORDER, number: 'CORD-2026-00002' } }));
      if (url.searchParams.get('tail') === '1') return json(route, { data: [], meta: { after_seq: shared.seq, next_after_seq: shared.seq, has_more: false, limit: 1, head_seq: shared.seq } });
      return json(route, { data: events, meta: { after_seq: after, next_after_seq: events.length ? events[events.length - 1].seq : after, has_more: false, limit: 100, head_seq: shared.seq } });
    }
    if (p === '/commerce/orders/attention') {
      return json(route, {
        data: [{ order: { id: ORDER, number: 'CORD-2026-00002', storefront_id: 's1', sales_channel_id: 'c1', delivery_method: 'standard', created_at: new Date(Date.now() - 60_000).toISOString() }, payment: { method: 'cod', status: 'awaiting_collection' }, reasons: ['new_order'], alert: { pending: !shared.acked } }],
        meta: { truncated: false, window_hours: 48, limit: 100 },
      });
    }
    if (method === 'POST' && /\/acknowledge$/.test(p)) {
      shared.acked = true;
      shared.acks += 1;
      shared.seq += 1;
      shared.events.push({ seq: shared.seq, type: 'order.acknowledged' });
      return json(route, { data: { order_id: ORDER, acknowledged: true, acknowledged_at: new Date().toISOString(), created: shared.acks === 1 } });
    }
    if (method === 'GET' && p === '/commerce/orders') {
      // الطلب 2 مقبول تلقائياً: «جديد» ما دام تنبيهه قائماً، ثم «مقبول» بعد الإقرار.
      const f = url.searchParams.get('fulfillment_status');
      const data = f === 'not_started' && url.searchParams.get('payment_status') === 'awaiting_collection' ? [row()] : [];
      return json(route, { data, meta: { current_page: 1, per_page: 50, total: data.length, last_page: 1 } });
    }
    if (p === '/notifications/unread-count') return json(route, { data: { count: 0 } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  await context.addInitScript((userJson) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    const w = window as unknown as { __plays: number };
    w.__plays = 0;
    HTMLMediaElement.prototype.play = function () { w.__plays += 1; return Promise.resolve(); };
  }, JSON.stringify(user));
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as { __plays: number }).__plays);
const pendingCount = (page: Page) => page.getByTestId('board-pending-count');
const feedCount = (page: Page) => {
  const state = { n: 0 };
  page.on('request', (r) => { if (/\/api\/commerce\/orders\/feed/.test(r.url())) state.n += 1; });

  return state;
};

test('الصوت: يعمل بعد التسليح ويتكرر ما دام التنبيه قائماً ثم يتوقف بالإقرار', async ({ browser }) => {
  const context = await browser.newContext();
  await device(context, newShared());
  const page = await context.newPage();
  await page.goto(`${baseUrl}/commerce/orders/live`);
  await expect(pendingCount(page)).toContainText('1', { timeout: 20_000 });
  expect(await plays(page)).toBe(0); // لا صوت قبل التسليح
  await page.getByTestId('board-sound-enable').click();
  await expect.poll(() => plays(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2); // التسليح ثم التكرار
  await page.locator('[data-testid="board-card-ack"]').click();
  await expect(pendingCount(page)).toContainText('0');
  const settled = await plays(page);
  await page.waitForTimeout(6_000); // أطول من فاصل التكرار (4ث)
  expect(await plays(page)).toBe(settled); // لا تشغيل بعد الإقرار
  await context.close();
});

test('تبادل القيادة: التبويب الأول يستطلع وحده، وعند إغلاقه يتولى الثاني الاستطلاع', async ({ browser }) => {
  const context = await browser.newContext();
  await device(context, newShared());
  const a = await context.newPage();
  const aFeed = feedCount(a);
  await a.goto(`${baseUrl}/commerce/orders/live`);
  await expect(pendingCount(a)).toContainText('1', { timeout: 20_000 });
  const b = await context.newPage();
  const bFeed = feedCount(b);
  await b.goto(`${baseUrl}/commerce/orders/live`);
  await expect(pendingCount(b)).toContainText('1', { timeout: 20_000 }); // يتلقى اللقطة من القائد
  await a.waitForTimeout(3_000);
  const bBefore = bFeed.n;
  const aBefore = aFeed.n;
  await a.waitForTimeout(3_000);
  expect(aFeed.n).toBeGreaterThan(aBefore); // القائد يستطلع
  expect(bFeed.n - bBefore).toBeLessThanOrEqual(1); // المتابع لا يستطلع

  await a.close(); // قائد يغادر ⇒ تحرير القفل
  const bAfterClose = bFeed.n;
  await expect.poll(() => bFeed.n, { timeout: 20_000 }).toBeGreaterThan(bAfterClose + 1); // الثاني صار قائداً
  await context.close();
});

test('الإقرار عبر جهازين: إقرار الجهاز الأول يُسكت الثاني ويحرّك البطاقة من «جديد» إلى «مقبول»', async ({ browser }) => {
  const shared = newShared();
  const one = await browser.newContext();
  const two = await browser.newContext();
  await device(one, shared);
  await device(two, shared);
  const p1 = await one.newPage();
  const p2 = await two.newPage();
  await p1.goto(`${baseUrl}/commerce/orders/live`);
  await p2.goto(`${baseUrl}/commerce/orders/live`);
  for (const page of [p1, p2]) {
    await expect(pendingCount(page)).toContainText('1', { timeout: 20_000 });
    await expect(page.locator('[data-testid="board-col-new"] [data-testid="board-card"]')).toHaveCount(1);
  }
  await p1.locator('[data-testid="board-card-ack"]').click();
  await expect(pendingCount(p1)).toContainText('0');
  // الجهاز الثاني يعلم من التغذية/المصالحة في دورة استطلاع (≈ ثوانٍ) لا فورياً.
  await expect(pendingCount(p2)).toContainText('0', { timeout: 20_000 });
  await expect(p2.locator('[data-testid="board-col-new"] [data-testid="board-card"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(p2.locator('[data-testid="board-col-accepted"] [data-testid="board-card"]')).toHaveCount(1);
  expect(shared.acks).toBe(1); // إقرار خادمي واحد فقط
  await one.close();
  await two.close();
});
