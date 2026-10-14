import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-5a — تحقق في متصفح حقيقي من أن الحوارين المحايدين (`components/shared/*`) يعملان كما كانا عبر
 * شاشة Webhooks للمطوّر (الغلافان `components/developer/*`): تأكيد التدوير والحذف، وكشف السرّ لمرة واحدة.
 * لا يظهر أي إجراء لنقاط الاستقبال في هذه المرحلة. الخادم مُعترَض بالكامل (بلا خلفية)، والسرّ قيمة حارسة وهمية.
 * اللقطات تُكتب فقط حين يُضبط `INT_UX5A_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX5A_SHOTS;
const SECRET = 'whsec_SENTINEL_ONE_TIME_VALUE_0123456789';

const hook = {
  id: 'h1', api_client_id: null, url: 'https://example.test/hooks/awj', description: 'Orders', event_types: ['invoice.created'],
  status: 'enabled', secret_prefix: 'whsec_xx', disabled_at: null, last_success_at: null, last_failure_at: null,
  created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
};

async function open(page: Page, locale: 'ar' | 'en', theme: 'light' | 'dark', requests: string[]) {
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/developer/webhooks' && route.request().method() === 'GET') return json(route, { data: [hook] });
    if (path === '/developer/webhooks/h1/rotate-secret') return json(route, { secret: SECRET, webhook: hook });
    if (path === '/me') return json(route, { user: { id: 'u1', name: 'المالك', role: 'owner', permissions: ['*'] }, company: { name: 'نبراس الطموح' } });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    return json(route, { data: [] });
  });
  const user = { id: 'u1', name: 'المالك', email: 'o@test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', u);
    localStorage.setItem('theme', t);
  }, [theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/developer/webhooks`, { waitUntil: 'domcontentloaded' });
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`webhook rotate → confirm → one-time secret (${locale}/${theme})`, async ({ page }, info) => {
      const requests: string[] = [];
      await open(page, locale, theme, requests);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);

      await page.getByRole('button', { name: /details|تفاصيل/i }).first().click();
      await page.getByRole('menuitem', { name: /rotate|تدوير/i }).dispatchEvent('click');

      const confirm = page.getByRole('dialog');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('https://example.test/hooks/awj');
      await expect(confirm.locator('[dir="ltr"]').first()).toBeVisible();
      await shot(page, `confirm-${locale}-${theme}-${info.project.name}`);
      await confirm.getByRole('button').last().click();

      // السرّ: مقنّع، لا يظهر في DOM قبل الكشف، وزرّ الإغلاق مُعطَّل حتى التأكيد.
      const reveal = page.getByRole('dialog');
      await expect(reveal.locator('code')).toBeVisible();
      expect(await page.content()).not.toContain(SECRET);
      const done = reveal.getByRole('button').last();
      await expect(done).toBeDisabled();
      await shot(page, `secret-masked-${locale}-${theme}-${info.project.name}`);

      await reveal.getByRole('button', { name: /reveal|إظهار/i }).click();
      await expect(reveal.locator('code')).toHaveText(SECRET);
      await expect(reveal.locator('code')).toHaveAttribute('dir', 'ltr');
      await shot(page, `secret-revealed-${locale}-${theme}-${info.project.name}`);

      // السلوك القديم محفوظ: لا قفل على الإغلاق في شاشة المطوّر (Escape يغلق)، والسرّ يزول من DOM ولا يُكتب في التخزين.
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
      expect(stored).not.toContain(SECRET);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await page.content()).not.toContain(SECRET);

      // لا طلب غير الذي طُلب، ولا أي مسار لنقاط الاستقبال.
      expect(requests.some((r) => r.includes('delivery-connectors'))).toBe(false);
      expect(requests).toContain('POST /developer/webhooks/h1/rotate-secret');
    });
  }
}

test('the integration center detail page has no management action yet (5a adds none)', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'en', url: baseUrl }]);
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (route.request().method() !== 'GET') writes.push(`${route.request().method()} ${path}`);
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/applications/nav-state') return json({ data: { 'sales.pos': true } });
    if (path === '/delivery-platforms/readiness') return json({ data: ['keeta'].map((platform_key) => ({ platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false })) });
    if (path === '/delivery-connectors') return json({ data: [{ id: 'a', platform_key: 'keeta', external_store_id: 'S-1', branch_id: null, status: 'configured', secret_version: 1, created_at: '2026-10-01T08:00:00Z', disabled_at: null }] });
    return json({ data: [] });
  });
  const user = { id: 'u1', name: 'O', email: 'o@test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.addInitScript((u) => { localStorage.setItem('token', 't'); localStorage.setItem('user', u); }, JSON.stringify(user));
  await page.goto(`${baseUrl}/integrations/delivery-platforms/keeta`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('signed-ingress-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  expect(await panel.getByRole('button').count()).toBe(0);
  expect(writes).toEqual([]);
});
