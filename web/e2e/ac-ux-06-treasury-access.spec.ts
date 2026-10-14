import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-06 — صلاحيات الإيداع/السحب على الخزينة والحساب البنكي في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي):
 * محدِّدٌ بالأسماء بدل حقلٍ نصٍّ حرّ، جملةٌ تلخّص القاعدة، تحذير القفل الذاتي، منعُ حفظ نطاقٍ بلا مرجع، وصفحة التفاصيل
 * تقرأ القاعدة بالأسماء (لا slug ولا UUID خاماً)، مع تدرّج الصلاحيات (D-J). اللقطات تُكتب فقط حين يُضبط `AC_UX06_SHOTS`.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX06_SHOTS;
const USER_ID = '0b9f6c1e-aaaa-bbbb-cccc-111122223333';

interface World {
  writes: { method: string; path: string; body: Record<string, unknown> }[];
}

const ACCOUNT = {
  id: 'a1', account_id: 'x', account_code: '1110', account_name: 'Cash', type: 'cash', name: 'Main cashbox', currency: 'SAR',
  is_active: true, is_main: true, balance: '1000',
  deposit_scope: 'user', deposit_scope_subject: USER_ID, withdraw_scope: 'role', withdraw_scope_subject: 'role-ab12cd34',
};

async function open(page: Page, w: World, opts: { path: string; locale?: 'ar' | 'en'; role?: string; permissions?: string[] }) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (method !== 'GET') w.writes.push({ method, path, body: JSON.parse(route.request().postData() ?? '{}') });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (/^\/cash-bank-accounts(\/a1)?$/.test(path) && method !== 'GET') return json(route, { data: { id: 'a1' } });
    if (path === '/cash-bank-accounts/a1') return json(route, { data: ACCOUNT });
    if (path.startsWith('/cash-bank-transfers')) return json(route, { data: [] });
    if (path === '/roles') return json(route, { data: [
      { id: 'r1', slug: 'staff', name: 'Floor staff', is_owner: false, is_system: true, permissions: ['invoices.view'] },
      { id: 'r2', slug: 'role-ab12cd34', name: 'Cashier', is_owner: false, is_system: false, permissions: ['payments.view'] },
    ], meta: { permissions: [] } });
    if (path === '/users') return json(route, { data: [
      { id: USER_ID, name: 'Hind Alharbi', email: 'hind@acme.test', role: 'staff', is_active: true, employee: null, branch_ids: [], warehouse_ids: [] },
    ] });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
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
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const world = (): World => ({ writes: [] });

test.describe('AC-UX-06 treasury access rules', () => {
  test('the form replaces the free-text identifier with named pickers, summarises the rule, and blocks a rule without a subject', async ({ page }, info) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/new?type=cash' });
    const deposit = page.getByRole('group', { name: 'Who may deposit' });
    await page.locator('form input[required]').first().fill('Petty cash');

    await expect(deposit.getByText('Anyone whose role allows it can deposit.')).toBeVisible();
    await deposit.getByRole('radio', { name: /Role/ }).check();
    await expect(deposit.getByText('Choose a role, or switch to "All".')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    await deposit.locator('select').selectOption('role-ab12cd34');
    await expect(deposit.getByText('Only users with the role “Cashier” can deposit.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-form`);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0]).toMatchObject({ method: 'POST', path: '/cash-bank-accounts' });
    expect(w.writes[0].body).toMatchObject({ deposit_scope: 'role', deposit_scope_subject: 'role-ab12cd34', withdraw_scope: 'all', withdraw_scope_subject: null });
  });

  test('warns when the rule would lock the editor out (owners and admins are not exempt)', async ({ page }) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/new?type=bank' });
    const withdraw = page.getByRole('group', { name: 'Who may withdraw' });
    await withdraw.getByRole('radio', { name: /Role/ }).check();
    await withdraw.locator('select').selectOption('staff'); // المحرِّر owner
    await expect(withdraw.getByRole('note')).toContainText("Your own role isn't included");
    await expect(withdraw.getByRole('note')).toContainText('owners and admins are not exempt');
  });

  test('editing shows the saved rules by name and saves them unchanged', async ({ page }) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/new?edit=a1' });
    const deposit = page.getByRole('group', { name: 'Who may deposit' });
    await expect(deposit.getByText(/Only Hind Alharbi \W*\(hind@acme\.test\)\W* can deposit\./)).toBeVisible();
    await expect(page.getByText(USER_ID)).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0]).toMatchObject({ method: 'PUT', path: '/cash-bank-accounts/a1' });
    expect(w.writes[0].body).toMatchObject({ deposit_scope: 'user', deposit_scope_subject: USER_ID, withdraw_scope: 'role', withdraw_scope_subject: 'role-ab12cd34' });
  });

  test('the detail page reads the rules as sentences, never as raw identifiers', async ({ page }, info) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/a1' });
    // على الجوال قسم الصلاحيات أكورديون مطويّ افتراضياً.
    if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Permissions' }).click();
    await expect(page.getByText(/Only Hind Alharbi \W*\(hind@acme\.test\)\W* can deposit\./).first()).toBeVisible();
    await expect(page.getByText('Only users with the role “Cashier” can withdraw.').first()).toBeVisible();
    await expect(page.getByText(USER_ID)).toHaveCount(0);
    await expect(page.getByText('role-ab12cd34')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-detail`);
  });

  test('a manager who cannot list users or roles keeps the saved rule, cannot pick a new subject, and sees no raw identifier', async ({ page }) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/new?edit=a1', role: 'role-x', permissions: ['payments.view', 'payments.manage'] });
    const deposit = page.getByRole('group', { name: 'Who may deposit' });
    await expect(deposit.getByText(/A specific user is set \(their name isn't available to you\)/)).toBeVisible();
    await expect(deposit.getByRole('radio', { name: /Role/ })).toBeDisabled();
    await expect(page.getByText(USER_ID)).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0].body).toMatchObject({ deposit_scope: 'user', deposit_scope_subject: USER_ID });
  });

  test('Arabic renders the rule sentences RTL with no overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { path: '/cash-and-bank/new?edit=a1', locale: 'ar' });
    await expect(page.getByText('يقتصر السحب على المستخدمين أصحاب الدور «Cashier».')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-form`);
  });
});
