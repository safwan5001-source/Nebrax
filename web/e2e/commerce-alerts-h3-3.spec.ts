import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * COPS-H3-3 — مركز تنبيه الطلبات في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي RTL/LTR، فاتح/داكن). الخادم مُعترَض بالكامل.
 * يتحقق من: بوابة مغلقة ⇒ لا طلبات استطلاع، تهيئة من الرأس لا التاريخ، الشارة والقائمة، شريط تفعيل الصوت، الإسكات، الاتجاه، عدم تجاوز العرض الأفقي،
 * وأن المقيَّد بمخازن لا يستدعي التغذية. اللقطات تُكتب فقط حين يُضبط `H33_SHOTS`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.H33_SHOTS;

const row = (id: string, number: string) => ({
  order: { id, number, storefront_id: 's1', sales_channel_id: 'c1', delivery_method: 'standard', created_at: '2026-11-03T10:00:00+03:00' },
  payment: { method: 'cod', status: 'awaiting_collection' },
  reasons: ['new_order', 'awaiting_acceptance'],
  alert: { pending: true },
});

type Opts = { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; enabled?: boolean; mode?: 'feed_attention' | 'attention_only'; rows?: number };

async function open(page: Page, opts: Opts = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  const rows = Array.from({ length: opts.rows ?? 2 }, (_, i) => row(`0000000${i}-1111-4111-8111-111111111111`, `CORD-2026-0000${i + 1}`));
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}${url.search}`);
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/commerce/workspace/storefronts') return json(route, { data: { stores: [{ id: 's1', name: 'زهور طيبة', sales_channel_id: 'c1', is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts', domains: [] }] } });
    if (p === '/commerce/alerts/config') {
      return json(route, { data: { enabled: opts.enabled ?? true, mode: opts.mode ?? 'feed_attention', polling: { feed_ms: 10000, attention_ms: 60000, attention_only_ms: 15000 } } });
    }
    if (p === '/commerce/orders/feed') {
      return json(route, { data: [], meta: { after_seq: 5, next_after_seq: 5, has_more: false, limit: 100, head_seq: 5 } });
    }
    if (p === '/commerce/orders/attention') return json(route, { data: rows, meta: { truncated: false, window_hours: 48, limit: 100 } });
    if (p === '/notifications/unread-count') return json(route, { data: { count: 0 } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/commerce`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const trigger = (page: Page) => page.getByRole('button', { name: /تنبيهات الطلبات|Order alerts/ });

for (const locale of ['ar', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${locale}/${theme}: الشارة والقائمة وشريط الصوت وعدم تجاوز العرض`, async ({ page }, info) => {
      const requests = await open(page, { locale, theme });
      await expect(page.getByTestId('alert-badge')).toHaveText('2', { timeout: 15_000 });
      expect(await page.locator('html').getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(requests.filter((r) => r.includes('/commerce/orders/feed')).some((r) => r.includes('tail=1'))).toBe(true);
      // لا تمرير للتاريخ: لا طلب feed?after_seq=0 عند التهيئة.
      expect(requests.some((r) => /orders\/feed\?after_seq=0/.test(r))).toBe(false);

      await expect(page.getByTestId('alert-sound-bar')).toBeVisible();
      await shot(page, `${info.project.name}-${locale}-${theme}-closed`);

      await trigger(page).click();
      await expect(page.getByTestId('alert-panel')).toBeVisible();
      await expect(page.getByTestId('alert-item')).toHaveCount(2);
      await expect(page.getByTestId('alert-item').first()).toContainText('CORD-2026-00001');
      await noHorizontalOverflow(page);
      await shot(page, `${info.project.name}-${locale}-${theme}-open`);
    });
  }
}

test('الإسكات يُنقص الشارة والعنصر، والطلب لا يُحذف من الخادم (لا كتابة)', async ({ page }) => {
  const requests = await open(page);
  await expect(page.getByTestId('alert-badge')).toHaveText('2', { timeout: 15_000 });
  await trigger(page).click();
  await page.getByRole('button', { name: /إسكات على هذا الجهاز/ }).first().click();
  await expect(page.getByTestId('alert-item')).toHaveCount(1);
  await expect(page.getByTestId('alert-badge')).toHaveText('1');
  expect(requests.filter((r) => !r.startsWith('GET')).length).toBe(0);
});

test('تفعيل الصوت بنقرة يُخفي الشريط الدائم', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('alert-sound-bar')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('alert-sound-bar').getByRole('button').click();
  await expect(page.getByTestId('alert-sound-bar')).toBeHidden({ timeout: 5_000 });
});

test('بوابة مغلقة: لا مركز تنبيه ولا أي طلب استطلاع', async ({ page }) => {
  const requests = await open(page, { enabled: false });
  await page.waitForTimeout(2_500);
  await expect(page.getByTestId('alert-badge')).toHaveCount(0);
  await expect(page.getByTestId('alert-sound-bar')).toHaveCount(0);
  expect(requests.some((r) => /orders\/(feed|attention)/.test(r))).toBe(false);
});

test('المقيَّد بمخازن (attention_only): لا طلب تغذية أبداً', async ({ page }) => {
  const requests = await open(page, { mode: 'attention_only' });
  await expect(page.getByTestId('alert-badge')).toHaveText('2', { timeout: 15_000 });
  expect(requests.some((r) => /orders\/feed/.test(r))).toBe(false);
  await trigger(page).click();
  await expect(page.getByText(/طلبات مخازنك فقط/)).toBeVisible();
});

test('99+ ومئة صف لا تكسر التخطيط على الجوال', async ({ page }) => {
  await open(page, { rows: 120 });
  await expect(page.getByTestId('alert-badge')).toHaveText('99+', { timeout: 15_000 });
  await trigger(page).click();
  await noHorizontalOverflow(page);
});
