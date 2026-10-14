import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-02 — محرّر المستخدم (لوحة جانبية) في متصفح حقيقي: سطح مكتب 1440 + جوال 390، عربي/إنجليزي.
 * الخادم مُعترَض بحالة قابلة للتعديل؛ لا خلفية. نتحقق من: فتح اللوحة، «الفراغ = الكل»، منع «محدَّد» الفارغ،
 * الحمولة الفرقية وحدها، حماية التعديلات غير المحفوظة، رسالة الخادم عند الرفض، وغياب التمرير الأفقي.
 * اللقطات تُكتب فقط حين يُضبط `AC_UX02_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX02_SHOTS;

interface World {
  writes: { method: string; path: string; body: Record<string, unknown> }[];
  users: Record<string, unknown>[];
  putStatus: 200 | 403;
}

const u = (over: Record<string, unknown>) => ({
  id: 'u0', name: 'User', email: 'user@acme.test', role: 'staff', is_active: true,
  employee_id: null, employee: null, branch_ids: [], warehouse_ids: [], ...over,
});

const world = (over: Partial<World> = {}): World => ({
  writes: [],
  putStatus: 200,
  users: [
    u({ id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'owner' }),
    u({ id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'role-ab12cd34', branch_ids: ['b1'] }),
    u({ id: 'u3', name: 'Amal Qahtani', email: 'amal@acme.test', role: 'accountant' }),
  ],
  ...over,
});

async function open(page: Page, w: World, opts: { locale?: 'ar' | 'en'; permissions?: string[]; role?: string; theme?: 'light' | 'dark' } = {}) {
  const locale = opts.locale ?? 'en';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (method !== 'GET') w.writes.push({ method, path, body: JSON.parse(route.request().postData() ?? '{}') });
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/users' && method === 'GET') return json(route, { data: w.users });
    const one = /^\/users\/([^/]+)$/.exec(path);
    if (one && method === 'PUT') {
      if (w.putStatus === 403) return json(route, { message: 'You cannot assign a branch outside your own access.' }, 403);
      const row = w.users.find((x) => x.id === one[1]);
      if (row) Object.assign(row, JSON.parse(route.request().postData() ?? '{}'));
      return json(route, { data: row });
    }
    if (path === '/roles') return json(route, { data: [
      { id: 'r1', slug: 'owner', name: 'Owner', is_owner: true, is_system: true, permissions: ['*'] },
      { id: 'r2', slug: 'accountant', name: 'Accountant', is_owner: false, is_system: true, permissions: ['invoices.view', 'payments.view'] },
      { id: 'r3', slug: 'staff', name: 'Staff', is_owner: false, is_system: true, permissions: ['invoices.view'] },
      { id: 'r4', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false, permissions: ['invoices.view', 'invoices.manage', 'users.view'] },
    ] });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }, { id: 'b3', name: 'Jubail' }] });
    if (path === '/warehouses') return json(route, { data: [{ id: 'w1', name: 'Main store', branch_id: 'b1' }, { id: 'w2', name: 'Cold store', branch_id: 'b2' }] });
    if (path === '/employees') return json(route, { data: [] });
    if (path === '/me') return json(route, { user: { id: 'me', name: 'Safwan', role: 'owner', permissions: ['*'] }, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}/users`, { waitUntil: 'domcontentloaded' });
  // مؤشّر Next في وضع التطوير يعلو تذييل اللوحة على الجوال ويعترض النقر؛ ليس جزءاً من المنتج.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const rowOf = (page: Page, name: string) =>
  page.locator('tr, [data-awj-mobile-record], div.p-3\\.5').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: /More actions|المزيد من الإجراءات/ }) }).first();

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

const editHind = async (page: Page, label = 'Edit') => {
  await rowOf(page, 'Hind Alharbi').getByRole('button', { name: label, exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
};

test.describe('AC-UX-02 user editor', () => {
  test('opens as a side sheet with identity, role, access scope and a live summary', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    const sheet = await editHind(page);

    await expect(sheet.getByRole('heading', { name: 'Identity' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Access scope' })).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /Selected branches only/ })).toBeChecked();
    await expect(sheet.getByRole('radio', { name: /All warehouses/ })).toBeChecked(); // الفراغ = الكل
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();       // لا تغيير بعد
    await expect(sheet.getByText('Access summary').locator('..')).toContainText('1 branch');
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-editor`);
  });

  test('sends only the changed fields, never an accidental empty scope', async ({ page }) => {
    const w = world();
    await open(page, w);
    const sheet = await editHind(page);

    await sheet.getByRole('checkbox', { name: 'Khobar' }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0]).toMatchObject({ method: 'PUT', path: '/users/u2' });
    expect(Object.keys(w.writes[0].body)).toEqual(['branch_ids']);
    expect((w.writes[0].body.branch_ids as string[]).sort()).toEqual(['b1', 'b2']);
  });

  test('"Selected" with nothing ticked is refused before any request', async ({ page }) => {
    const w = world();
    await open(page, w);
    const sheet = await editHind(page);

    await sheet.getByRole('checkbox', { name: 'Dammam' }).uncheck();
    await expect(sheet.getByText('Select at least one branch, or switch to all branches.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(w.writes).toEqual([]);
  });

  test('closing a dirty editor asks first; Escape does not drop the edits', async ({ page }) => {
    const w = world();
    await open(page, w);
    const sheet = await editHind(page);

    await sheet.getByLabel('Name').fill('Hind A.');
    await page.keyboard.press('Escape');
    await expect(sheet.getByText('Discard unsaved changes?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet.getByLabel('Name')).toHaveValue('Hind A.');

    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(w.writes).toEqual([]);
  });

  test('a refused save shows the server message and keeps the editor open', async ({ page }) => {
    const w = world({ putStatus: 403 });
    await open(page, w);
    const sheet = await editHind(page);

    await sheet.getByRole('checkbox', { name: 'Jubail' }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert')).toContainText('You cannot assign a branch outside your own access.');
    await expect(sheet).toBeVisible();
    await expect(page.getByText('Updated successfully')).toHaveCount(0);
  });

  test('the row access action opens the editor scrolled to the access scope', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await rowOf(page, 'Hind Alharbi').getByRole('button', { name: 'Access scope' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Access scope' })).toBeInViewport();
    await shot(page, `en-${info.project.name}-access`);
  });

  test('a manage-only viewer gets the editor without lookups: scope is read-only and not sent', async ({ page }) => {
    const w = world();
    await open(page, w, { role: 'role-x', permissions: ['users.view', 'users.manage'] });
    const sheet = await editHind(page);

    await expect(sheet.getByText(/Editing branches requires/)).toBeVisible();
    await expect(sheet.getByRole('radio')).toHaveCount(0);
    await sheet.getByLabel('Name').fill('Hind B.');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0].body).toEqual({ name: 'Hind B.' });
  });

  test('Arabic renders RTL with the editor mirrored and no overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { locale: 'ar' });
    await expect(page.getByRole('heading', { name: 'المستخدمون' })).toBeVisible();
    await rowOf(page, 'Hind Alharbi').getByRole('button', { name: 'تعديل', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'نطاق الوصول' })).toBeVisible();
    await expect(sheet.getByRole('radio', { name: /كل المستودعات/ })).toBeChecked();
    await sheet.getByRole('heading', { name: 'نطاق الوصول' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-editor`);
  });

  test('dark theme keeps the editor legible', async ({ page }, info) => {
    const w = world();
    await open(page, w, { theme: 'dark' });
    await editHind(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-editor-dark`);
  });
});
