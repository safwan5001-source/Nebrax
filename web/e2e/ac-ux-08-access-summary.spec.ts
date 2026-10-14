import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-08 — ملخّص وصول المستخدم (قراءة فقط من الإسنادات المصدرية) في متصفح حقيقي: سطح مكتب 1440 + جوال 390،
 * عربي/إنجليزي. الخادم مُعترَض بالكامل. نتحقق من: محتوى الملخّص، «الفراغ = الكل»، التدرّج عند غياب القوائم
 * (D-J)، غياب زر التعديل لمن لا يملكه، الانتقال إلى المحرّر، RTL، وغياب التمرير الأفقي.
 * اللقطات تُكتب فقط حين يُضبط `AC_UX08_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX08_SHOTS;

const u = (over: Record<string, unknown>) => ({
  id: 'u0', name: 'User', email: 'user@acme.test', role: 'staff', is_active: true,
  employee_id: null, employee: null, branch_ids: [], warehouse_ids: [], ...over,
});

const USERS = [
  u({ id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'owner' }),
  u({ id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'role-ab12cd34', branch_ids: ['b1', 'b2'], employee: { id: 'e1', name: 'Hind Alharbi', employee_no: 'E-7' } }),
  u({ id: 'u3', name: 'Amal Qahtani', email: 'amal@acme.test', role: 'accountant', is_active: false }),
];

async function open(page: Page, requests: string[], opts: { locale?: 'ar' | 'en'; permissions?: string[]; role?: string; theme?: 'light' | 'dark' } = {}) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/users') return json(route, { data: USERS });
    if (path === '/roles') return json(route, { data: [
      { id: 'r1', slug: 'owner', name: 'Owner', is_owner: true, is_system: true, permissions: ['*'] },
      { id: 'r4', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false, permissions: ['invoices.view', 'invoices.manage', 'users.manage'] },
    ] });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }, { id: 'b3', name: 'Jubail' }] });
    if (path === '/warehouses') return json(route, { data: [{ id: 'w1', name: 'Main store', branch_id: 'b1' }] });
    if (path === '/employees') return json(route, { data: [] });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/users`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const summaryButton = (page: Page, name: string, label = 'Access summary') =>
  page.locator('tr, [data-awj-mobile-record], div.p-3\\.5')
    .filter({ hasText: name })
    .filter({ has: page.getByRole('button', { name: label, exact: true }) })
    .first()
    .getByRole('button', { name: label, exact: true });

const noHorizontalOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

test.describe('AC-UX-08 access summary', () => {
  test('shows sign-in, role with counts, named branches, empty warehouses = all, employee link and the honesty note', async ({ page }, info) => {
    await open(page, []);
    await summaryButton(page, 'Hind Alharbi').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Access summary/ })).toBeVisible();
    await expect(sheet.getByText('Can sign in.')).toBeVisible();
    await expect(sheet.getByText('Branch manager')).toBeVisible();
    await expect(sheet.getByText(/3 permissions/)).toBeVisible();
    await expect(sheet.getByText('Limited to 2 branches')).toBeVisible();
    await expect(sheet.getByText('Dammam')).toBeVisible();
    await expect(sheet.getByText('Khobar')).toBeVisible();
    await expect(sheet.getByText(/All warehouses/)).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'E-7 — Hind Alharbi' })).toHaveAttribute('href', '/hr/employees/e1');
    await expect(sheet.getByRole('note')).toContainText('only what is assigned');
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-summary`);
  });

  test('an inactive user is described as unable to sign in', async ({ page }) => {
    await open(page, []);
    await summaryButton(page, 'Amal Qahtani').click();
    await expect(page.getByRole('dialog').getByText(/Cannot sign in/)).toBeVisible();
  });

  test('a view-only viewer gets the summary without Edit and without requesting roles', async ({ page }) => {
    const requests: string[] = [];
    await open(page, requests, { role: 'role-x', permissions: ['users.view'] });
    await summaryButton(page, 'Hind Alharbi').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/Role permission details need access/)).toBeVisible();
    await expect(sheet.getByText('Limited to 2 branches')).toBeVisible();
    await expect(sheet.getByText(/Branch names need access/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    expect(requests.filter((r) => /^GET \/(roles|warehouses)$/.test(r))).toEqual([]);
    await expect(sheet.getByText('role-ab12cd34')).toHaveCount(0);
  });

  test('Edit from the summary hands over to the editor', async ({ page }) => {
    await open(page, []);
    await summaryButton(page, 'Hind Alharbi').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('heading', { name: 'Access scope' })).toBeVisible();
    await expect(editor.getByText('Can sign in.', { exact: true })).toHaveCount(0); // لوحة الملخّص أُغلقت وحلّ المحرّر مكانها
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('Arabic renders RTL with translated sentences and no overflow', async ({ page }, info) => {
    await open(page, [], { locale: 'ar' });
    await summaryButton(page, 'Hind Alharbi', 'ملخّص الوصول').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('مقيَّد بفرعين')).toBeVisible();
    await expect(sheet.getByText(/كل المستودعات/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-summary`);
  });

  test('dark theme keeps the summary legible', async ({ page }, info) => {
    await open(page, [], { theme: 'dark' });
    await summaryButton(page, 'Hind Alharbi').click();
    await expect(page.getByRole('dialog').getByText('Limited to 2 branches')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-summary-dark`);
  });
});
