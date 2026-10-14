import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-05 — محرّر النطاق المشترك في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي):
 * نموذج الموظف («إضافة ▸ مستخدم») يستعمل «الكل/محدَّد» نفسها كشاشة المستخدمين، ويُمنع «محدَّد» الفارغ قبل أي طلب،
 * والحمولة بحذف مفتاح «الكل»، وإشعار «القائمة مقصورة على نطاقك» لمن نطاقه مقيَّد.
 * اللقطات تُكتب فقط حين يُضبط `AC_UX05_SHOTS`.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX05_SHOTS;

interface World {
  writes: { method: string; path: string; body: Record<string, unknown> }[];
}

async function open(
  page: Page,
  w: World,
  opts: { path: string; locale?: 'ar' | 'en'; role?: string; permissions?: string[]; users?: unknown[] },
) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (method !== 'GET') w.writes.push({ method, path, body: JSON.parse(route.request().postData() ?? '{}') });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/employees' && method === 'POST') return json(route, { data: { id: 'e9', name: 'Hind' } }, 201);
    if (path === '/users' && method === 'POST') return json(route, { data: { id: 'u9' } }, 201);
    if (path === '/users' && method === 'GET') return json(route, { data: opts.users ?? [] });
    if (path === '/roles') return json(route, { data: [
      { id: 'r3', slug: 'staff', name: 'Staff', is_owner: false, is_system: true, permissions: ['invoices.view'] },
    ], meta: { permissions: [] } });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/warehouses') return json(route, { data: [{ id: 'w1', name: 'Main store', branch_id: 'b1' }] });
    if (path === '/me') return json(route, { user: { id: 'me', name: 'Safwan', role: 'owner', permissions: ['*'] }, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', 'light');
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}${opts.path}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};
const world = (): World => ({ writes: [] });

/** HR ▸ إضافة ▸ مستخدم: يفتح نموذج الموظف مع قسم الدخول مفعَّلاً. */
async function openAddUser(page: Page, add = 'Add', option = 'User') {
  await page.getByRole('button', { name: add, exact: true }).click();
  await page.getByRole('menuitem', { name: option }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('AC-UX-05 shared scope editor', () => {
  test('the employee dialog uses All / Selected, blocks an empty selection, and omits the key for All', async ({ page }, info) => {
    const w = world();
    await open(page, w, { path: '/hr' });
    const dialog = await openAddUser(page);

    await expect(dialog.getByRole('radio', { name: /All branches/ })).toBeChecked();
    await dialog.getByLabel('Name', { exact: true }).fill('Hind');
    await dialog.locator('#login_email').fill('hind@acme.test');
    await dialog.locator('#login_password').fill('secret-pass-1');

    await dialog.getByRole('radio', { name: /Selected branches only/ }).check();
    await expect(dialog.getByText('Select at least one branch, or switch to all branches.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(w.writes).toEqual([]);
    await dialog.getByRole('radio', { name: /Selected branches only/ }).scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-employee-scope`);

    await dialog.getByRole('radio', { name: /All branches/ }).check(); // يعود غير مقيَّد
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.some((x) => x.path === '/users')).toBe(true);
    const created = w.writes.find((x) => x.path === '/users')!;
    expect(created.method).toBe('POST');
    expect(created.body).not.toHaveProperty('branch_ids');
    expect(created.body).not.toHaveProperty('warehouse_ids');
  });

  test('"Selected" sends exactly the ticked branches', async ({ page }) => {
    const w = world();
    await open(page, w, { path: '/hr' });
    const dialog = await openAddUser(page);
    await dialog.getByLabel('Name', { exact: true }).fill('Hind');
    await dialog.locator('#login_email').fill('hind@acme.test');
    await dialog.locator('#login_password').fill('secret-pass-1');
    await dialog.getByRole('radio', { name: /Selected branches only/ }).check();
    await dialog.getByRole('checkbox', { name: 'Khobar' }).check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.some((x) => x.path === '/users')).toBe(true);
    expect(w.writes.find((x) => x.path === '/users')!.body.branch_ids).toEqual(['b2']);
  });

  test('a scope-limited manager is told the list is limited to their own access and cannot pick All', async ({ page }) => {
    const w = world();
    const users = [{
      id: 'me', name: 'Mgr', email: 'm@acme.test', role: 'role-mgr', is_active: true,
      employee_id: null, employee: null, branch_ids: ['b1'], warehouse_ids: [],
    }];
    await open(page, w, {
      path: '/users', role: 'role-mgr', users,
      permissions: ['users.view', 'users.manage', 'roles.view', 'branches.view', 'products.view'],
    });
    await page.getByRole('button', { name: 'Add user' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/this list shows only those, and you can only assign branches from within it/)).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /All branches/ })).toBeDisabled();
    await expect(sheet.getByRole('radio', { name: /Selected branches only/ })).toBeChecked();
  });

  test('a scope-limited admin adding a user from HR cannot pick All and is not left with a half-created employee', async ({ page }) => {
    const w = world();
    const users = [{
      id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'admin', is_active: true,
      employee_id: null, employee: null, branch_ids: ['b1'], warehouse_ids: [],
    }];
    await open(page, w, { path: '/hr', role: 'admin', users });
    const dialog = await openAddUser(page);
    await expect(dialog.getByRole('radio', { name: /All branches/ })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Selected branches only/ })).toBeChecked();
    await dialog.getByLabel('Name', { exact: true }).fill('Hind');
    await dialog.locator('#login_email').fill('hind@acme.test');
    await dialog.locator('#login_password').fill('secret-pass-1');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(w.writes).toEqual([]);
    await dialog.getByRole('checkbox', { name: 'Dammam' }).check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.some((x) => x.path === '/users')).toBe(true);
    expect(w.writes.find((x) => x.path === '/users')!.body.branch_ids).toEqual(['b1']);
  });

  test('Arabic renders the shared editor RTL with no overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { path: '/hr', locale: 'ar' });
    const dialog = await openAddUser(page, 'إضافة', 'مستخدم');
    await expect(dialog.getByRole('radio', { name: /كل الفروع/ })).toBeChecked();
    await dialog.getByRole('radio', { name: /فروع محدَّدة فقط/ }).check();
    await expect(dialog.getByText('اختر فرعاً واحداً على الأقل، أو بدّل إلى كل الفروع.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-employee-scope`);
  });
});
