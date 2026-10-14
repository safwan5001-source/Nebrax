import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-04 — تكرار دورٍ على جانب العميل في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي).
 * نتحقق من: لوحة «تكرار الدور» مبذورة، إشعار النسخ، أن الحفظ POST بالاسم والصلاحيات وحدهما دون أي كتابة على
 * المصدر، استبعاد ما لا يملك الفاعل منحه، حارس التجاهل، وغياب الزر عن العرض فقط.
 * اللقطات تُكتب فقط حين يُضبط `AC_UX04_SHOTS`.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX04_SHOTS;

interface World {
  writes: { method: string; path: string; body: Record<string, unknown> }[];
}

const CATALOG = ['invoices.view', 'invoices.manage', 'users.view', 'users.manage', 'pos.audit.view', 'pos.audit.export'];
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view'], is_system: false, is_owner: false, users_count: 3 },
];

async function open(page: Page, w: World, opts: { locale?: 'ar' | 'en'; permissions?: string[]; role?: string } = {}) {
  await page.context().addCookies([{ name: 'locale', value: opts.locale ?? 'en', url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (method !== 'GET') w.writes.push({ method, path, body: JSON.parse(route.request().postData() ?? '{}') });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/roles' && method === 'GET') return json(route, { data: ROLES, meta: { permissions: CATALOG } });
    if (path === '/roles' && method === 'POST') return json(route, { data: { id: 'r9' } }, 201);
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', 'light');
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/roles`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};
const choose = async (page: Page, name: string, projectName: string) => {
  if (projectName === 'mobile') await page.locator('#role-select').selectOption({ label: name });
  else await page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
};
const world = (): World => ({ writes: [] });

test.describe('AC-UX-04 role clone', () => {
  test('Duplicate opens a pre-filled new role; saving POSTs only name + permissions and never touches the source', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await choose(page, 'Branch manager', info.project.name);
    await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: 'Duplicate role' }).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Duplicate role' })).toBeVisible();
    await expect(sheet.getByRole('note')).toContainText('Copied from "Branch manager"');
    await expect(sheet.getByLabel('Role name')).toHaveValue('Branch manager (copy)');
    await expect(sheet.getByRole('region', { name: 'Invoices' }).getByRole('checkbox', { name: 'Manage' })).toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeEnabled();
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-clone`);

    await sheet.getByLabel('Role name').fill('Branch lead');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0].method).toBe('POST');
    expect(w.writes[0].path).toBe('/roles');
    expect(Object.keys(w.writes[0].body).sort()).toEqual(['name', 'permissions']);
    expect(w.writes[0].body).toEqual({ name: 'Branch lead', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view'] });
    expect(w.writes.some((x) => x.method === 'PUT' || x.method === 'DELETE')).toBe(false);
  });

  test('an untouched copy still asks before it is discarded', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await choose(page, 'Branch manager', info.project.name);
    await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: 'Duplicate role' }).click();
    const sheet = page.getByRole('dialog');
    await page.keyboard.press('Escape');
    await expect(sheet.getByText('Discard unsaved changes?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(w.writes).toEqual([]);
  });

  test('a limited manager gets a copy without what they cannot grant, and is told', async ({ page }, info) => {
    const w = world();
    await open(page, w, { role: 'role-mgr', permissions: ['roles.view', 'roles.manage', 'invoices.view', 'pos.audit.view'] });
    await choose(page, 'Branch manager', info.project.name);
    await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: 'Duplicate role' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('note')).toContainText('1 permission you cannot grant was left out.');
    await expect(sheet.getByRole('region', { name: 'Invoices' }).getByRole('checkbox', { name: 'Manage' })).not.toBeChecked();
    await expect(sheet.getByRole('region', { name: 'Invoices' }).getByRole('checkbox', { name: 'Manage' })).toBeDisabled();
  });

  test('view-only viewers have no Duplicate control', async ({ page }, info) => {
    const w = world();
    await open(page, w, { role: 'role-x', permissions: ['roles.view'] });
    await choose(page, 'Branch manager', info.project.name);
    await expect(page.getByRole('region', { name: 'Branch manager' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duplicate role' })).toHaveCount(0);
  });

  test('Arabic renders the clone sheet RTL with a localized copy name and no overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { locale: 'ar' });
    await choose(page, 'Branch manager', info.project.name);
    await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: 'تكرار الدور' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'تكرار الدور' })).toBeVisible();
    await expect(sheet.getByLabel('اسم الدور')).toHaveValue('Branch manager (نسخة)');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-clone`);
  });
});
