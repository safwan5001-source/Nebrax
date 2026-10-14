import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-03B — محرّر الدور في متصفح حقيقي: سطح مكتب 1440 + جوال 390، عربي/إنجليزي.
 * الخادم مُعترَض؛ نتحقق من: فتح اللوحة، تبديل المجموعة ثلاثي الحالة، علامة الحساسية نصّاً وملخّصها،
 * ملخّص التغيير قبل الحفظ، الحمولة بالمفاتيح الكنسية حرفياً، حماية التعديلات غير المحفوظة، رسالة الخادم
 * عند الرفض، الإنشاء، وغياب التمرير الأفقي. اللقطات تُكتب فقط حين يُضبط `AC_UX03B_SHOTS`.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX03B_SHOTS;

interface World {
  writes: { method: string; path: string; body: Record<string, unknown> }[];
  putStatus: 200 | 403;
}

const CATALOG = ['invoices.view', 'invoices.manage', 'users.view', 'users.manage', 'payments.view', 'payments.manage', 'pos.audit.view', 'pos.audit.export', 'zatca.view', 'zatca.submit'];
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view'], is_system: false, is_owner: false, users_count: 3 },
];

async function open(page: Page, w: World, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark' } = {}) {
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
    if (/^\/roles\/[^/]+$/.test(path) && method === 'PUT') {
      if (w.putStatus === 403) return json(route, { message: 'You cannot grant permissions beyond your own.' }, 403);
      return json(route, { data: ROLES[1] });
    }
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
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

const openEditor = async (page: Page, projectName: string, label = 'Edit role') => {
  await choose(page, 'Branch manager', projectName);
  await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: label }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
};

const world = (over: Partial<World> = {}): World => ({ writes: [], putStatus: 200, ...over });

test.describe('AC-UX-03B role editor', () => {
  test('opens as a side sheet; sensitive grants are labelled in text and summarised before saving', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    const sheet = await openEditor(page, info.project.name);

    await expect(sheet.getByRole('note')).toContainText('Changes apply immediately to the 3 users');
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(sheet.getByText('No sensitive permissions selected')).toBeVisible();

    await sheet.getByRole('region', { name: 'Users' }).getByRole('checkbox', { name: 'Manage' }).check();
    await expect(sheet.getByText('1 sensitive permission selected')).toBeVisible();
    await expect(sheet.getByText('Changes access or security').first()).toBeVisible();
    await expect(sheet.getByText(/Sensitive permissions being added: Users: Manage/)).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-editor`);
  });

  test('group toggle is tri-state and the payload carries canonical keys verbatim', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    const sheet = await openEditor(page, info.project.name);

    const pos = sheet.getByRole('region', { name: 'Point of sale' });
    const group = pos.getByRole('checkbox', { name: 'Select all in Point of sale' });
    expect(await group.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true); // pos.audit.view فقط
    await group.check();
    await expect(pos.getByRole('checkbox', { name: 'Audit — Export' })).toBeChecked();

    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0]).toMatchObject({ method: 'PUT', path: '/roles/r3' });
    expect(w.writes[0].body.permissions).toEqual(['invoices.view', 'invoices.manage', 'pos.audit.view', 'pos.audit.export']);
    expect(w.writes[0].body.name).toBe('Branch manager');
  });

  test('closing a dirty editor asks first; Escape does not drop the edits', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    const sheet = await openEditor(page, info.project.name);

    await sheet.getByLabel('Role name').fill('Branch lead');
    await page.keyboard.press('Escape');
    await expect(sheet.getByText('Discard unsaved changes?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet.getByLabel('Role name')).toHaveValue('Branch lead');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(w.writes).toEqual([]);
  });

  test('a refused save shows the server message and keeps the editor open', async ({ page }, info) => {
    const w = world({ putStatus: 403 });
    await open(page, w);
    const sheet = await openEditor(page, info.project.name);

    await sheet.getByRole('region', { name: 'Payments' }).getByRole('checkbox', { name: 'Manage' }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert')).toContainText('You cannot grant permissions beyond your own.');
    await expect(sheet).toBeVisible();
    await expect(page.getByText('Updated successfully')).toHaveCount(0);
  });

  test('creating a role needs a name and a permission, then POSTs both', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await page.getByRole('button', { name: 'New role' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();

    await sheet.getByLabel('Role name').fill('Viewer');
    await expect(sheet.getByText('Select at least one permission.')).toBeVisible();
    await sheet.getByRole('region', { name: 'Invoices' }).getByRole('checkbox', { name: 'View' }).check();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => w.writes.length).toBe(1);
    expect(w.writes[0]).toMatchObject({ method: 'POST', path: '/roles', body: { name: 'Viewer', permissions: ['invoices.view'] } });
    void info;
  });

  test('Arabic renders RTL with translated labels and no overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { locale: 'ar' });
    await choose(page, 'Branch manager', info.project.name);
    await page.getByRole('region', { name: 'Branch manager' }).getByRole('button', { name: 'تعديل الدور' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /الصلاحيات/ })).toBeVisible();
    await sheet.getByRole('region', { name: 'المستخدمون' }).getByRole('checkbox', { name: 'إدارة' }).check();
    await expect(sheet.getByText('يغيّر الوصول أو الأمان').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-editor`);
  });

  test('dark theme keeps the editor legible', async ({ page }, info) => {
    const w = world();
    await open(page, w, { theme: 'dark' });
    const sheet = await openEditor(page, info.project.name);
    await sheet.getByRole('region', { name: 'Users' }).getByRole('checkbox', { name: 'Manage' }).check();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-editor-dark`);
  });
});
