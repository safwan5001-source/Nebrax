import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * INT-UX-5c — إنشاء نقطة استقبال موقّعة من تفاصيل المنصة، في متصفح حقيقي بنقرات ولوحة مفاتيح حقيقية (لا `dispatchEvent`).
 * الخادم مُعترَض بالكامل بحالة قابلة للتعديل (لا خلفية ولا مزوّد)، والسرّ قيمة حارسة وهمية: هذا ليس إثبات تشغيل على Backend حقيقي.
 * اللقطات تُكتب فقط حين يُضبط `INT_UX5C_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.INT_UX5C_SHOTS;
const SECRET = 'dsec_SENTINEL_E2E_CREATED_SECRET_0123456789abcdef';
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';
const SIX = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'];

interface World {
  requests: { method: string; path: string; body?: unknown }[];
  rows: Record<string, unknown>[];
  profile: 'active' | 'none';
  create: 'ok' | 'abort' | '409';
  /** الخادم أنشأ النقطة لكنها خارج نطاق فروع المستخدم فلا تظهر في قائمته. */
  hideCreated?: boolean;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ing-1', delivery_platform_profile_id: 'prof-1', platform_key: 'keeta', external_store_id: 'KTA-OLD-0001', branch_id: null,
  configured_by: 'u', operated_by: 'u', status: 'configured', secret_prefix: 'x', secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

async function open(page: Page, opts: { locale: 'ar' | 'en'; theme: 'light' | 'dark'; permissions?: string[]; role?: string }, world: World) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    world.requests.push({ method, path, body: method === 'POST' ? route.request().postDataJSON() : undefined });
    if (path === '/applications/nav-state') return json(route, { data: { 'sales.pos': true } });
    if (path === '/delivery-platforms/readiness') return json(route, { data: SIX.map((platform_key) => ({ platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false })) });
    if (path === '/delivery-platforms') return json(route, { data: world.profile === 'active' ? [{ id: 'prof-1', platform_key: 'keeta', is_active: true }] : [] });
    if (path === '/branches') return json(route, { data: [{ id: 'br-1', name: 'فرع الدمام', is_active: true }, { id: 'br-2', name: 'فرع الخبر', is_active: true }, { id: 'br-3', name: 'فرع مغلق', is_active: false }] });
    if (path === '/delivery-connectors' && method === 'GET') return json(route, { data: world.rows.filter((r) => !r.hidden) });
    if (path === '/delivery-connectors' && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, string>;
      if (world.create === '409') return json(route, { message: SERVER_TEXT, error_code: 'mapping_ambiguous' }, 409);
      world.rows.push(row({ id: 'ing-new', external_store_id: body.external_store_id, branch_id: body.branch_id ?? null, secret_version: 1, hidden: world.hideCreated === true }));
      if (world.create === 'abort') return route.abort('connectionreset');
      return json(route, { data: world.rows[world.rows.length - 1], secret: SECRET }, 201);
    }
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

const world = (over: Partial<World> = {}): World => ({ requests: [], rows: [row()], profile: 'active', create: 'ok', ...over });
const writes = (w: World) => w.requests.filter((r) => r.method !== 'GET');
const listReads = (w: World) => w.requests.filter((r) => r.method === 'GET' && r.path === '/delivery-connectors').length;
const visible = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

for (const [locale, dir] of [['ar', 'rtl'], ['en', 'ltr']] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${locale}/${theme}`, () => {
      test('create: validate → branch → one-time masked secret with a locked close → list refreshed only after closing', async ({ page }, info) => {
        const w = world();
        await open(page, { locale, theme }, w);
        expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
        const tag = `${locale}-${theme}-${info.project.name}`;
        await shot(page, `panel-${tag}`);

        await page.getByTestId('ingress-create-open').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        // فروع نشطة فقط + «بلا فرع».
        expect(await page.getByTestId('ingress-create-branch').locator('option').count()).toBe(3);
        await expect(page.getByTestId('ingress-create-boundary')).toBeVisible();
        await shot(page, `create-form-${tag}`);

        // التحقق قبل الإرسال: لا طلب.
        await page.getByTestId('ingress-create-submit').click();
        await expect(page.getByTestId('ingress-create-store-id-error')).toBeVisible();
        expect(writes(w)).toEqual([]);
        await shot(page, `create-validation-${tag}`);

        await page.getByTestId('ingress-create-store-id').fill('  KTA-RIYADH-0042  ');
        await page.getByTestId('ingress-create-branch').selectOption('br-2');
        const readsBefore = listReads(w);
        await page.getByTestId('ingress-create-submit').click();

        const reveal = page.getByRole('dialog');
        await expect(reveal.locator('code')).toBeVisible();
        expect(await page.content()).not.toContain(SECRET);
        expect(writes(w)).toEqual([{ method: 'POST', path: '/delivery-connectors', body: { delivery_platform_profile_id: 'prof-1', external_store_id: 'KTA-RIYADH-0042', branch_id: 'br-2' } }]);
        await expect(reveal.getByRole('button', { name: /^(close|إغلاق)$/i })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByTestId('secret-dismiss-hint')).toBeVisible();
        await shot(page, `secret-locked-${tag}`);

        await reveal.getByRole('button', { name: /show secret|إظهار السر/i }).click();
        await expect(reveal.locator('code')).toHaveText(SECRET);
        await expect(reveal.locator('code')).toHaveAttribute('dir', 'ltr');
        await shot(page, `secret-revealed-${tag}`);
        // القائمة لم تُحدَّث خلف السرّ.
        expect(listReads(w)).toBe(readsBefore);

        await reveal.getByRole('checkbox').check();
        await reveal.getByRole('button').last().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await page.content()).not.toContain(SECRET);
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        expect(stored).not.toContain(SECRET);
        expect(page.url()).not.toContain(SECRET);
        await expect(page.getByTestId('ingress-management-notice')).toContainText('KTA-RIYADH-0042');
        await expect.poll(() => listReads(w)).toBeGreaterThan(readsBefore);
        await expect(page.getByTestId('signed-ingress-panel')).toContainText('KTA-RIYADH-0042');
        await expect(page.getByTestId('signed-ingress-panel')).toContainText('فرع الخبر');
        expect(writes(w)).toHaveLength(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await shot(page, `created-${tag}`);
      });

      test('an explicit refusal keeps the form open with a fixed message and no server text', async ({ page }, info) => {
        const w = world({ create: '409' });
        await open(page, { locale, theme }, w);
        await page.getByTestId('ingress-create-open').click();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        await page.getByTestId('ingress-create-store-id').fill('KTA-OLD-0001');
        await page.getByTestId('ingress-create-submit').click();
        await expect(page.getByTestId('ingress-create-error')).toBeVisible();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await page.content()).not.toContain(SERVER_TEXT);
        expect(writes(w)).toHaveLength(1);
        await shot(page, `create-refused-${locale}-${theme}-${info.project.name}`);
      });

      test('a lost response is an unknown outcome: one request, no retry, the list is re-read and the new point is reported with its rotate action', async ({ page }, info) => {
        const w = world({ create: 'abort' });
        await open(page, { locale, theme }, w);
        const before = listReads(w);
        await page.getByTestId('ingress-create-open').click();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        await page.getByTestId('ingress-create-store-id').fill('KTA-RIYADH-0042');
        await page.getByTestId('ingress-create-submit').click();

        const notice = page.getByTestId('ingress-management-notice');
        await expect(notice).toHaveAttribute('data-kind', 'createLost');
        await expect(notice.getByRole('button')).toHaveCount(1);
        await expect.poll(() => listReads(w)).toBeGreaterThan(before);
        await page.waitForTimeout(400);
        expect(writes(w)).toHaveLength(1);
        const newRow = page.locator('[data-testid="signed-ingress-row"]:visible', { hasText: 'KTA-RIYADH-0042' });
        await expect(newRow.getByTestId('ingress-rotate')).toBeVisible();
        await shot(page, `create-unknown-${locale}-${theme}-${info.project.name}`);
      });

      test('a fresh list without the point does NOT mean the creation failed: neutral "could not be confirmed", no failure claim, no retry', async ({ page }, info) => {
        const w = world({ create: 'abort', hideCreated: true });
        await open(page, { locale, theme }, w);
        const before = listReads(w);
        await page.getByTestId('ingress-create-open').click();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        await page.getByTestId('ingress-create-store-id').fill('KTA-HIDDEN-0099');
        await page.getByTestId('ingress-create-submit').click();

        const notice = page.getByTestId('ingress-management-notice');
        await expect(notice).toHaveAttribute('data-kind', 'createUnconfirmed');
        await expect(notice).toHaveText(new RegExp(locale === 'ar' ? 'تعذّر تأكيد نتيجة الإنشاء\\. لا تُعِد المحاولة قبل التحقق من نقطة الاستقبال أو التواصل مع المسؤول\\.' : 'The creation result could not be confirmed\\. Do not retry until the ingress point has been verified or an administrator has been contacted\\.'));
        expect(await notice.innerText()).not.toMatch(/not created|was not|لم تُنشأ|فشل الإنشاء|لم تظهر/i);
        await expect(notice.getByRole('button')).toHaveCount(1);
        await expect.poll(() => listReads(w)).toBeGreaterThan(before);
        // لا صفّ للنقطة في القائمة (محجوبة بنطاق الفروع)؛ المعرّف يظهر فقط في تذكير الحظر الدائم لا كنقطة.
        await expect(page.locator('[data-testid="signed-ingress-row"]', { hasText: 'KTA-HIDDEN-0099' })).toHaveCount(0);
        await page.waitForTimeout(400);
        expect(writes(w)).toHaveLength(1);
        await shot(page, `create-unconfirmed-${locale}-${theme}-${info.project.name}`);
      });

      test('after an unknown outcome the same store ID cannot be re-sent (even after closing the notice and reopening the form), a different one can; a hard reload clears the guard (documented limit)', async ({ page }, info) => {
        const w = world({ create: 'abort', hideCreated: true });
        await open(page, { locale, theme }, w);
        const tag = `${locale}-${theme}-${info.project.name}`;
        await page.getByTestId('ingress-create-open').click();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        await page.getByTestId('ingress-create-store-id').fill('KTA-HIDDEN-0099');
        await page.getByTestId('ingress-create-submit').click();
        const notice = page.getByTestId('ingress-management-notice');
        await expect(notice).toHaveAttribute('data-kind', 'createUnconfirmed');
        await notice.getByRole('button').click();
        await expect(notice).toHaveCount(0);
        // تذكير دائم بالمعرّف المحظور بعد إغلاق الإشعار.
        await expect(page.getByTestId('ingress-create-blocked-note')).toContainText('KTA-HIDDEN-0099');

        await page.getByTestId('ingress-create-open').click();
        await expect(page.getByTestId('ingress-create-branch')).toBeVisible();
        await page.getByTestId('ingress-create-store-id').fill('KTA-HIDDEN-0099');
        await expect(page.getByTestId('ingress-create-store-id-error')).toBeVisible();
        await expect(page.getByTestId('ingress-create-submit')).toBeDisabled();
        await page.getByTestId('ingress-create-store-id').press('Enter');
        await page.waitForTimeout(300);
        expect(writes(w)).toHaveLength(1);
        await shot(page, `create-blocked-${tag}`);

        // معرّف مختلف مسموح.
        w.create = 'ok';
        w.hideCreated = false;
        await page.getByTestId('ingress-create-store-id').fill('KTA-OTHER-0100');
        await expect(page.getByTestId('ingress-create-submit')).toBeEnabled();
        await page.getByTestId('ingress-create-submit').click();
        await expect(page.getByRole('dialog').locator('code')).toBeVisible();
        expect(writes(w)).toHaveLength(2);
        await page.getByRole('dialog').getByRole('checkbox').check();
        await page.getByRole('dialog').getByRole('button').last().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // حدّ معلن: إعادة تحميل كاملة تمحو الحارس (ذاكرة الصفحة فقط) — بانتظار قرار المالك.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('signed-ingress-panel')).toHaveAttribute('data-state', 'ready');
        await expect(page.getByTestId('ingress-create-blocked-note')).toHaveCount(0);
      });

      test('without an active manual profile: guidance with a link to the existing setup, no create action', async ({ page }, info) => {
        const w = world({ profile: 'none', rows: [] });
        await open(page, { locale, theme }, w);
        const guidance = page.getByTestId('ingress-create-guidance');
        await expect(guidance).toBeVisible();
        await expect(guidance.getByRole('link')).toHaveAttribute('href', '/delivery-platforms');
        await expect(page.getByTestId('ingress-create-open')).toHaveCount(0);
        expect(writes(w)).toEqual([]);
        await shot(page, `guidance-${locale}-${theme}-${info.project.name}`);
      });
    });
  }
}

test('no create for a viewer without manage; without branches.view the form has no branch field and says why', async ({ page }) => {
  const viewer = world();
  await open(page, { locale: 'en', theme: 'light', permissions: ['invoices.view', 'delivery_connector.view'], role: 'custom' }, viewer);
  await expect(page.getByTestId('ingress-create-open')).toHaveCount(0);
  await expect(page.getByTestId('ingress-create-guidance')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  const manager = world();
  await open(page, { locale: 'en', theme: 'light', permissions: ['invoices.view', 'delivery_connector.view', 'delivery_connector.manage'], role: 'custom' }, manager);
  // الغلاف نفسه قد يقرأ الفروع؛ الشرط أن النموذج لا يطلبها بلا الصلاحية.
  const branchReadsBefore = manager.requests.filter((r) => r.path === '/branches').length;
  await page.getByTestId('ingress-create-open').click();
  await expect(page.getByTestId('ingress-create-branch-unavailable')).toBeVisible();
  await expect(page.getByTestId('ingress-create-branch')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(manager.requests.filter((r) => r.path === '/branches').length).toBe(branchReadsBefore);
});
