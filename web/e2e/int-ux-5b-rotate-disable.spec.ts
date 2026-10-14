import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-5b — تدوير سرّ نقطة الاستقبال الموقّعة وتعطيلها، في متصفح حقيقي بنقرات ولوحة مفاتيح حقيقية
 * (لا `dispatchEvent`). الخادم مُعترَض بالكامل بحالة قابلة للتعديل (لا خلفية ولا مزوّد)، والسرّ قيمة حارسة وهمية.
 * اللقطات تُكتب فقط حين يُضبط `INT_UX5B_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX5B_SHOTS;
const SECRET = 'dsec_SENTINEL_E2E_ROTATED_SECRET_0123456789abcdef';
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';
const SIX = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'];

interface World {
  requests: string[];
  rows: Record<string, unknown>[];
  rotate: 'ok' | 'abort' | '403' | '409';
  disable: 'ok' | 'abort';
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ing-1', delivery_platform_profile_id: 'p1', platform_key: 'keeta', external_store_id: 'KTA-RIYADH-0042', branch_id: null,
  configured_by: 'u', operated_by: 'u', status: 'configured', secret_prefix: 'x', secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

async function open(page: Page, opts: { locale: 'ar' | 'en'; theme: 'light' | 'dark'; permissions?: string[]; role?: string }, world: World) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    world.requests.push(`${method} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: { 'sales.pos': true } });
    if (path === '/delivery-platforms/readiness') return json(route, { data: SIX.map((platform_key) => ({ platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false })) });
    if (path === '/delivery-platforms') return json(route, { data: [] });
    if (path === '/delivery-connectors' && method === 'GET') return json(route, { data: world.rows });
    const target = /^\/delivery-connectors\/([^/]+)\/(rotate-secret|disable)$/.exec(path);
    if (target && method === 'POST') {
      const point = world.rows.find((r) => r.id === target[1]);
      if (target[2] === 'rotate-secret') {
        if (world.rotate === 'abort') return route.abort('connectionreset');
        if (world.rotate === '403') return json(route, { message: SERVER_TEXT }, 403);
        if (world.rotate === '409') return json(route, { message: SERVER_TEXT, error_code: 'connector_unavailable' }, 409);
        if (point) point.secret_version = Number(point.secret_version) + 1;
        return json(route, { data: point, secret: SECRET });
      }
      if (world.disable === 'abort') {
        // الخادم أتمّ التعطيل لكن الاستجابة ضاعت.
        if (point) Object.assign(point, { status: 'disabled', disabled_at: '2026-10-14T00:00:00Z' });
        return route.abort('connectionreset');
      }
      if (point) Object.assign(point, { status: 'disabled', disabled_at: '2026-10-14T00:00:00Z' });
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

const world = (over: Partial<World> = {}): World => ({ requests: [], rows: [row(), row({ id: 'ing-2', external_store_id: 'KTA-OLD-0001', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z' })], rotate: 'ok', disable: 'ok', ...over });
const writes = (w: World) => w.requests.filter((r) => !r.startsWith('GET '));
const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${locale}/${theme}`, () => {
      test('rotate: confirm → one-time masked secret with a locked close → cleared, with real clicks and keys', async ({ page }, info) => {
        const w = world();
        await open(page, { locale, theme }, w);
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        const tag = `${locale}-${theme}-${info.project.name}`;

        // نقطة معطّلة بلا إجراء، والمهيّأة بزرّين فقط.
        await expect(visible(page, 'ingress-rotate')).toHaveCount(1);
        await expect(visible(page, 'ingress-disable')).toHaveCount(1);
        await shot(page, `panel-${tag}`);

        await visible(page, 'ingress-rotate').click();
        const confirm = page.getByRole('dialog');
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('KTA-RIYADH-0042');
        await expect(confirm.locator('[dir="ltr"]').first()).toBeVisible();
        expect(writes(w)).toEqual([]);
        await shot(page, `rotate-confirm-${tag}`);
        await confirm.getByRole('button').last().click();

        const reveal = page.getByRole('dialog');
        await expect(reveal.locator('code')).toBeVisible();
        expect(await page.content()).not.toContain(SECRET);
        expect(writes(w)).toEqual(['POST /delivery-connectors/ing-1/rotate-secret']);

        // قفل الإغلاق: لا زرّ X، وEscape لا يغلق ويُظهر التلميح، والخلفية كذلك.
        await expect(reveal.getByRole('button', { name: /^(close|إغلاق)$/i })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByTestId('secret-dismiss-hint')).toBeVisible();
        await shot(page, `secret-locked-${tag}`);

        await reveal.getByRole('button', { name: /show secret|إظهار السر/i }).click();
        await expect(reveal.locator('code')).toHaveText(SECRET);
        await expect(reveal.locator('code')).toHaveAttribute('dir', 'ltr');
        await shot(page, `secret-revealed-${tag}`);

        // تأكيد الحفظ ثم الإغلاق بالزرّ؛ بعدها لا أثر للسر في DOM ولا التخزين ولا العنوان.
        await reveal.getByRole('checkbox').check();
        await reveal.getByRole('button').last().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.content()).not.toContain(SECRET);
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        expect(stored).not.toContain(SECRET);
        expect(page.url()).not.toContain(SECRET);
        await expect(page.getByTestId('ingress-management-notice')).toContainText('KTA-RIYADH-0042');
        // الإصدار الجديد ظهر بعد إعادة القراءة.
        await expect(page.getByTestId('signed-ingress-panel')).toContainText('4');
        expect(writes(w)).toHaveLength(1);
        await shot(page, `rotate-done-${tag}`);
      });

      test('disable: the store ID must be typed literally; success shows a disabled point with no action left', async ({ page }, info) => {
        const w = world();
        await open(page, { locale, theme }, w);
        const tag = `${locale}-${theme}-${info.project.name}`;

        await visible(page, 'ingress-disable').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const confirm = dialog.getByRole('button').last();
        await expect(confirm).toBeDisabled();
        const input = dialog.getByTestId('typed-confirmation-input');
        await input.fill('kta-riyadh-0042');
        await expect(confirm).toBeDisabled();
        await shot(page, `disable-confirm-${tag}`);
        await input.fill('KTA-RIYADH-0042');
        await expect(confirm).toBeEnabled();
        await confirm.click();

        await expect(page.getByTestId('ingress-management-notice')).toContainText('KTA-RIYADH-0042');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(writes(w)).toEqual(['POST /delivery-connectors/ing-1/disable']);
        await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready');
        await expect(visible(page, 'ingress-rotate')).toHaveCount(0);
        await expect(visible(page, 'ingress-disable')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await shot(page, `disable-done-${tag}`);
      });

      test('a lost rotate response is an unknown outcome: one request, no retry, a calm notice, the list re-read', async ({ page }, info) => {
        const w = world({ rotate: 'abort' });
        await open(page, { locale, theme }, w);
        const listBefore = w.requests.filter((r) => r === 'GET /delivery-connectors').length;
        await visible(page, 'ingress-rotate').click();
        await page.getByRole('dialog').getByRole('button').last().click();

        const notice = page.getByTestId('ingress-management-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toHaveAttribute('role', 'alert');
        await expect(notice.getByRole('button')).toHaveCount(1);
        await expect.poll(() => w.requests.filter((r) => r === 'GET /delivery-connectors').length).toBeGreaterThan(listBefore);
        expect(writes(w)).toEqual(['POST /delivery-connectors/ing-1/rotate-secret']);
        await page.waitForTimeout(400);
        expect(writes(w)).toHaveLength(1);
        await shot(page, `rotate-unknown-${locale}-${theme}-${info.project.name}`);
      });

      test('server errors never surface raw server text', async ({ page }) => {
        for (const rotate of ['403', '409'] as const) {
          const w = world({ rotate });
          await open(page, { locale, theme }, w);
          await visible(page, 'ingress-rotate').click();
          await page.getByRole('dialog').getByRole('button').last().click();
          await expect(page.getByTestId('ingress-management-notice')).toBeVisible();
          expect(await page.content()).not.toContain(SERVER_TEXT);
          await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
      });
    });
  }
}

test('a viewer without manage sees no management action and sends no write; with reassign + users.view (5d) only reassign appears, never rotate/disable', async ({ page }) => {
  const viewer = world();
  await open(page, { locale: 'en', theme: 'light', permissions: ['invoices.view', 'delivery_connector.view'], role: 'custom' }, viewer);
  await expect(page.getByTestId('signed-ingress-panel').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('signed-ingress-readonly-note')).toBeVisible();
  expect(writes(viewer)).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const operator = world();
  await open(page, { locale: 'en', theme: 'light', permissions: ['invoices.view', 'delivery_connector.view', 'delivery_connector.reassign', 'users.view'], role: 'custom' }, operator);
  const ids = await page.getByTestId('signed-ingress-panel').getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  expect([...new Set(ids)]).toEqual(['ingress-reassign']);
  expect(writes(operator)).toEqual([]);
});
