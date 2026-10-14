import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-11 — نطاق المستخدم نفسه يأتي من `/me` لا من صفّه في `GET /users`.
 * مدير مستخدمين مقيَّد بفرعٍ واحد، **وقائمة المستخدمين لا تحوي صفّه**، والتخزين المحلي بلا نطاق (جلسة أقدم):
 * الواجهة تقرأ `/me` فيعرف المحرّر أن «الكل» غير متاح له (يبدأ على «محدَّد» ويشرح السبب) بدل افتراض «غير مقيَّد».
 * الخادم مُعترَض؛ لا خلفية. اللقطات اختيارية (`AC_UX11_SHOTS`).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX11_SHOTS;

interface Me { branch_ids?: unknown; warehouse_ids?: unknown; status?: number }

async function open(page: Page, me: Me, opts: { locale?: 'ar' | 'en' } = {}) {
  const requests: string[] = [];
  await page.context().addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const stored = {
    id: 'mgr', name: 'Manager', email: 'mgr@acme.test', tenant_id: 't1', role: 'role-mgr',
    permissions: ['users.view', 'users.manage', 'branches.view', 'roles.view'],
  };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/me') {
      if (me.status && me.status !== 200) return json(route, { message: 'down' }, me.status);
      const { status: _status, ...scope } = me;
      return json(route, { user: { ...stored, ...scope }, company: { name: 'Acme' } });
    }
    // قائمة المستخدمين لا تحوي المدير نفسه: المصدر القديم كان يعطي «غير معروف».
    if (path === '/users') return json(route, { data: [
      { id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'staff', is_active: true, employee_id: null, employee: null, branch_ids: ['b1'], warehouse_ids: [] },
    ] });
    if (path === '/roles') return json(route, { data: [
      { id: 'r3', slug: 'staff', name: 'Staff', is_owner: false, is_system: true, permissions: ['invoices.view'] },
      { id: 'r4', slug: 'role-mgr', name: 'Manager', is_owner: false, is_system: false, permissions: ['invoices.view', 'users.view', 'users.manage', 'branches.view', 'roles.view'] },
    ] });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }] });
    if (path === '/warehouses') return json(route, { data: [] });
    if (path === '/employees') return json(route, { data: [] });
    return json(route, { data: [] });
  });

  await page.addInitScript((userJson) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, JSON.stringify(stored));
  await page.goto(`${baseUrl}/users`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  return requests;
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

const addUser = (page: Page) => page.getByRole('button', { name: /^(Add user|إضافة مستخدم)$/ });

test.describe('AC-UX-11 actor scope from /me', () => {
  test('a branch-restricted manager is recognised as restricted — "All branches" is not offered, with the reason', async ({ page }, info) => {
    const requests = await open(page, { branch_ids: ['b1'], warehouse_ids: [] });
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await addUser(page).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Your own access is limited to specific branches', { exact: false }).first()).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /Selected branches only/ })).toBeChecked();
    await expect(sheet.getByRole('radio', { name: /All branches/ })).toBeDisabled();
    expect(requests.filter((r) => r === 'GET /me').length).toBeGreaterThanOrEqual(1);
    await shot(page, `en-${info.project.name}-restricted`);
  });

  test('an unrestricted manager (empty arrays = unrestricted) can pick "All branches"', async ({ page }) => {
    await open(page, { branch_ids: [], warehouse_ids: [] });
    await addUser(page).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('radio', { name: /All branches/ })).toBeEnabled();
    await expect(sheet.getByRole('radio', { name: /All branches/ })).toBeChecked();
  });

  test('the scope is persisted into the stored user for later screens (no list needed)', async ({ page }) => {
    await open(page, { branch_ids: ['b1'], warehouse_ids: [] });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('user')!).branch_ids)).toEqual(['b1']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).warehouse_ids)).toEqual([]);
  });

  test('when /me fails the editor still opens (server stays the authority) and nothing is stored as "unrestricted"', async ({ page }) => {
    await open(page, { status: 500 });
    await addUser(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => 'branch_ids' in JSON.parse(localStorage.getItem('user')!))).toBe(false);
  });

  test('Arabic renders the restricted notice RTL with no overflow', async ({ page }, info) => {
    await open(page, { branch_ids: ['b1'], warehouse_ids: [] }, { locale: 'ar' });
    await addUser(page).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('وصولك الخاص مقصور على فروع محدَّدة', { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await shot(page, `ar-${info.project.name}-restricted`);
  });
});
