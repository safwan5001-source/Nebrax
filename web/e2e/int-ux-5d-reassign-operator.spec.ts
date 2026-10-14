import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-5d — إعادة إسناد المشغّل المسؤول عن نقطة استقبال موقّعة، في متصفح حقيقي بنقرات ولوحة مفاتيح حقيقية (لا `dispatchEvent`).
 * الخادم مُعترَض بالكامل بحالة قابلة للتعديل (لا خلفية حقيقية): هذه ليست مصادقة على خادم فعلي.
 * اللقطات تُكتب فقط حين يُضبط `INT_UX5D_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX5D_SHOTS;
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';
const EMAIL_DOMAIN = 'leak-sentinel.test';
const SIX = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'];

interface World {
  requests: string[];
  bodies: unknown[];
  rows: Record<string, unknown>[];
  users: unknown[];
  reassign: 'ok' | 'abort' | '403' | '409' | '422';
}

const person = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, email: `${id}@${EMAIL_DOMAIN}`, role: 'cashier', is_active: true, branch_ids: [], ...over });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ing-1', delivery_platform_profile_id: 'p1', platform_key: 'keeta', external_store_id: 'KTA-RIYADH-0042', branch_id: null,
  configured_by: 'u-cfg', operated_by: 'u-self', status: 'configured', secret_prefix: 'x', secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

async function open(page: Page, opts: { locale: 'ar' | 'en'; theme: 'light' | 'dark'; permissions?: string[]; role?: string }, w: World) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    w.requests.push(`${method} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: { 'sales.pos': true } });
    if (path === '/delivery-platforms/readiness') return json(route, { data: SIX.map((platform_key) => ({ platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false })) });
    if (path === '/delivery-platforms') return json(route, { data: [] });
    if (path === '/delivery-connectors' && method === 'GET') return json(route, { data: w.rows });
    if (path === '/users' && method === 'GET') return json(route, { data: w.users });
    const target = /^\/delivery-connectors\/([^/]+)\/reassign$/.exec(path);
    if (target && method === 'POST') {
      const body = route.request().postDataJSON() as { user_id?: string };
      w.bodies.push(body);
      const point = w.rows.find((r) => r.id === target[1]);
      if (w.reassign === 'abort') {
        // الخادم أتمّ الإسناد لكن الاستجابة ضاعت.
        if (point && body.user_id) point.operated_by = body.user_id;
        return route.abort('connectionreset');
      }
      if (w.reassign === '403') return json(route, { message: SERVER_TEXT }, 403);
      if (w.reassign === '409') return json(route, { message: SERVER_TEXT }, 409);
      if (w.reassign === '422') return json(route, { message: SERVER_TEXT, error_code: 'operator_ineligible' }, 422);
      if (point && body.user_id) point.operated_by = body.user_id;
      return json(route, { data: point });
    }
    if (path === '/branches') return json(route, { data: [] });
    if (path === '/me') return json(route, { user: { id: 'u1', name: 'المالك', role: 'owner', permissions: ['*'] }, company: { name: 'نبراس الطموح' } });
    return json(route, { data: [] });
  });
  const user = { id: 'u1', name: 'المالك', email: 'o@test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([theme, userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [opts.theme, JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/integrations/delivery-platforms/keeta`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready');
}

const world = (over: Partial<World> = {}): World => ({
  requests: [], bodies: [], reassign: 'ok',
  rows: [row(), row({ id: 'ing-2', external_store_id: 'KTA-OLD-0001', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z' })],
  users: [person('u-self', 'نورة السالم'), person('u-amal', 'أمل العتيبي'), person('u-bader', 'بدر الفرع', { branch_ids: ['br-1'] }), person('u-dina', 'دينا المعطّلة', { is_active: false })],
  ...over,
});
const writes = (w: World) => w.requests.filter((r) => !r.startsWith('GET '));
const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
async function openDialog(page: Page) {
  await expect(visible(page, 'signed-ingress-operator')).toHaveText('نورة السالم');
  await visible(page, 'ingress-reassign').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('reassign-select')).toBeVisible();
  return dialog;
}

for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${locale}/${theme}`, () => {
      test('reassign: names only, eligible only, confirm → one request → the shown operator changes', async ({ page }, info) => {
        const w = world();
        if (locale === 'en') w.users = [person('u-self', 'Noura Salem'), person('u-amal', 'Amal Otaibi'), person('u-bader', 'Bader Branch', { branch_ids: ['br-1'] }), person('u-dina', 'Dina Off', { is_active: false })];
        const self = locale === 'en' ? 'Noura Salem' : 'نورة السالم';
        const amal = locale === 'en' ? 'Amal Otaibi' : 'أمل العتيبي';
        await open(page, { locale, theme }, w);
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        const tag = `${locale}-${theme}-${info.project.name}`;

        await expect(visible(page, 'signed-ingress-operator')).toHaveText(self);
        await expect(visible(page, 'ingress-reassign')).toHaveCount(1); // نقطة مهيّأة واحدة فقط
        await shot(page, `panel-${tag}`);

        const dialog = await openDialog(page);
        // نقطة غير موجّهة لفرع: الأمل وحدها (المقيَّد بفرع والمعطّل والحالي خارج القائمة).
        const labels = await dialog.getByTestId('reassign-select').locator('option').allTextContents();
        expect(labels.slice(1)).toEqual([amal]);
        expect(await page.content()).not.toContain(EMAIL_DOMAIN);
        expect(writes(w)).toEqual([]);
        await expect(dialog.getByRole('button').last()).toBeDisabled();
        await shot(page, `reassign-dialog-${tag}`);

        await dialog.getByTestId('reassign-select').selectOption({ label: amal });
        await expect(dialog.getByTestId('reassign-summary')).toContainText(self);
        await expect(dialog.getByTestId('reassign-summary')).toContainText(amal);
        await shot(page, `reassign-selected-${tag}`);
        await dialog.getByRole('button').last().click();

        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByTestId('ingress-management-notice')).toContainText(amal);
        await expect(visible(page, 'signed-ingress-operator')).toHaveText(amal);
        expect(writes(w)).toEqual(['POST /delivery-connectors/ing-1/reassign']);
        expect(w.bodies).toEqual([{ user_id: 'u-amal' }]);
        expect(w.rows[0]).toMatchObject({ status: 'configured', secret_version: 3, branch_id: null, external_store_id: 'KTA-RIYADH-0042' });
        expect(await page.content()).not.toContain(EMAIL_DOMAIN);
        await shot(page, `reassign-done-${tag}`);
      });

      test('422 keeps the dialog with a safe message; raw server text never appears', async ({ page }, info) => {
        const w = world({ reassign: '422' });
        await open(page, { locale, theme }, w);
        const dialog = await openDialog(page);
        await dialog.getByTestId('reassign-select').selectOption({ index: 1 });
        await dialog.getByRole('button').last().click();
        await expect(dialog.getByTestId('reassign-error')).toBeVisible();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await page.content()).not.toContain(SERVER_TEXT);
        expect(writes(w)).toHaveLength(1);
        await shot(page, `reassign-422-${locale}-${theme}-${info.project.name}`);
      });

      test('403 and 409 close with a safe notice (no raw text)', async ({ page }) => {
        for (const outcome of ['403', '409'] as const) {
          const w = world({ reassign: outcome });
          await open(page, { locale, theme }, w);
          const dialog = await openDialog(page);
          await dialog.getByTestId('reassign-select').selectOption({ index: 1 });
          await dialog.getByRole('button').last().click();
          if (outcome === '403') {
            await expect(page.getByTestId('ingress-management-notice')).toBeVisible();
            await expect(page.getByRole('dialog')).toHaveCount(0);
          } else {
            await expect(dialog.getByTestId('reassign-error')).toBeVisible();
          }
          expect(await page.content()).not.toContain(SERVER_TEXT);
          expect(writes(w)).toHaveLength(1);
          await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
      });

      test('a lost response is an unknown outcome: one request, list re-read, no retry control, the real operator is shown', async ({ page }, info) => {
        const w = world({ reassign: 'abort' });
        await open(page, { locale, theme }, w);
        const dialog = await openDialog(page);
        await dialog.getByTestId('reassign-select').selectOption({ index: 1 });
        const readsBefore = w.requests.filter((r) => r === 'GET /delivery-connectors').length;
        await dialog.getByRole('button').last().click();
        await expect(page.getByTestId('ingress-management-notice')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect.poll(() => w.requests.filter((r) => r === 'GET /delivery-connectors').length).toBeGreaterThan(readsBefore);
        expect(writes(w)).toHaveLength(1);
        await expect(page.getByRole('button', { name: /retry|try again|إعادة المحاولة/i })).toHaveCount(0);
        await shot(page, `reassign-unknown-${locale}-${theme}-${info.project.name}`);
      });
    });
  }
}

test.describe('permissions in a real browser', () => {
  test('reassign without users.view shows nothing and never reads /users; reassign + users.view alone shows only reassign', async ({ page }) => {
    const w = world();
    await open(page, { locale: 'en', theme: 'light', role: 'custom', permissions: ['invoices.view', 'delivery_connector.view', 'delivery_connector.reassign'] }, w);
    await expect(page.getByTestId('ingress-reassign')).toHaveCount(0);
    await expect(page.getByTestId('signed-ingress-operator')).toHaveCount(0);
    expect(w.requests).not.toContain('GET /users');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    const w2 = world();
    await open(page, { locale: 'en', theme: 'light', role: 'custom', permissions: ['invoices.view', 'delivery_connector.view', 'delivery_connector.reassign', 'users.view'] }, w2);
    await expect(visible(page, 'ingress-reassign')).toHaveCount(1);
    await expect(page.getByTestId('ingress-rotate')).toHaveCount(0);
    await expect(page.getByTestId('ingress-disable')).toHaveCount(0);
  });

  test('a viewer sees no operator column and no buttons', async ({ page }) => {
    const w = world();
    await open(page, { locale: 'en', theme: 'light', role: 'custom', permissions: ['invoices.view', 'delivery_connector.view'] }, w);
    await expect(page.getByTestId('signed-ingress-operator')).toHaveCount(0);
    await expect(page.getByTestId('signed-ingress-panel').getByRole('button')).toHaveCount(0);
    expect(w.requests).not.toContain('GET /users');
  });
});
