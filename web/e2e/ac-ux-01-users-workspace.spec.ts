import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-01 — مساحة المستخدمين في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي).
 * الخادم مُعترَض بالكامل بحالة قابلة للتعديل؛ لا خلفية. نتحقق من: الجدول/البطاقات، نص الحالة،
 * معنى «الفراغ = الكل»، تأكيد التعطيل وشرح أثره، أن الحذف المرفوض لا يُظهر نجاحاً، العرض فقط،
 * وغياب التمرير الأفقي للصفحة. اللقطات تُكتب فقط حين يُضبط `AC_UX01_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX01_SHOTS;

interface World {
  requests: string[];
  users: Record<string, unknown>[];
  deleteStatus: 200 | 403;
}

const u = (over: Record<string, unknown>) => ({
  id: 'u0', name: 'User', email: 'user@acme.test', role: 'staff', is_active: true,
  employee_id: null, employee: null, branch_ids: [], warehouse_ids: [], ...over,
});

const world = (over: Partial<World> = {}): World => ({
  requests: [],
  deleteStatus: 200,
  users: [
    u({ id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'owner' }),
    u({ id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'role-ab12cd34', branch_ids: ['b1', 'b2', 'b3'], employee: { id: 'e1', name: 'Hind Alharbi', employee_no: 'E-17' }, employee_id: 'e1' }),
    u({ id: 'u3', name: 'Amal Qahtani', email: 'amal@acme.test', role: 'accountant', is_active: false, warehouse_ids: ['w1'] }),
  ],
  ...over,
});

async function open(page: Page, w: World, opts: { locale?: 'ar' | 'en'; permissions?: string[]; role?: string } = {}) {
  const locale = opts.locale ?? 'en';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    w.requests.push(`${method} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/users' && method === 'GET') return json(route, { data: w.users });
    const one = /^\/users\/([^/]+)$/.exec(path);
    if (one && method === 'PUT') {
      const row = w.users.find((x) => x.id === one[1]);
      if (row) Object.assign(row, JSON.parse(route.request().postData() ?? '{}'));
      return json(route, { data: row });
    }
    if (one && method === 'DELETE') {
      if (w.deleteStatus === 403) return json(route, { message: 'You cannot manage a user whose role exceeds your permissions.' }, 403);
      w.users = w.users.filter((x) => x.id !== one[1]);
      return json(route, { message: 'deleted' });
    }
    if (path === '/roles') return json(route, { data: [
      { id: 'r1', slug: 'owner', name: 'Owner', is_owner: true, is_system: true },
      { id: 'r2', slug: 'accountant', name: 'Accountant', is_owner: false, is_system: true },
      { id: 'r3', slug: 'staff', name: 'Staff', is_owner: false, is_system: true },
      { id: 'r4', slug: 'role-ab12cd34', name: 'Branch manager', is_owner: false, is_system: false },
    ] });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }, { id: 'b3', name: 'Jubail' }] });
    if (path === '/warehouses') return json(route, { data: [{ id: 'w1', name: 'Main store' }] });
    if (path === '/me') return json(route, { user: { id: 'me', name: 'Safwan', role: 'owner', permissions: ['*'] }, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, [JSON.stringify(user)] as const);
  await page.goto(`${baseUrl}/users`, { waitUntil: 'domcontentloaded' });
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

/** الصف الظاهر لمستخدم (جدول على سطح المكتب، بطاقة على الجوال). */
const rowOf = (page: Page, name: string) =>
  page.locator('tr, [data-awj-mobile-record], div.p-3\\.5').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: 'More actions' }) }).first();

test.describe('AC-UX-01 users workspace', () => {
  test('owner sees accurate status text, role names and scope summaries (empty = all)', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(page.getByText('Hind Alharbi').first()).toBeVisible();

    await expect(page.getByText('Branch manager').first()).toBeVisible();       // اسم الدور لا slug
    await expect(page.getByText('role-ab12cd34')).toHaveCount(0);
    await expect(page.getByText('Dammam +2').first()).toBeVisible();            // ملخّص النطاق
    await expect(page.getByText('All branches').first()).toBeVisible();         // الفراغ = الكل
    await expect(page.getByText('Inactive').first()).toBeVisible();             // الحالة نصّاً
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-owner`);
  });

  test('deactivation asks first, explains the consequences, then sends is_active=false', async ({ page }) => {
    const w = world();
    await open(page, w);
    await expect(page.getByText('Hind Alharbi').first()).toBeVisible();

    await rowOf(page, 'Hind Alharbi').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Deactivate account' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Sign-in and API access stop immediately');
    await expect(dialog).toContainText('employee record and its history are not deleted');
    expect(w.requests).not.toContain('PUT /users/u2');

    await dialog.getByRole('button', { name: 'Deactivate account' }).click();
    await expect.poll(() => w.requests.includes('PUT /users/u2')).toBe(true);
    expect(w.users.find((x) => x.id === 'u2')?.is_active).toBe(false);
  });

  test('a refused delete shows the server message and the row stays', async ({ page }) => {
    const w = world({ deleteStatus: 403 });
    await open(page, w);
    await expect(page.getByText('Amal Qahtani').first()).toBeVisible();

    await rowOf(page, 'Amal Qahtani').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText('You cannot manage a user whose role exceeds your permissions.').first()).toBeVisible();
    await expect(page.getByText('Deleted successfully')).toHaveCount(0);
    await expect(page.getByText('Amal Qahtani').first()).toBeVisible();
  });

  test('a view-only viewer gets a read-only workspace and no lookups it cannot read', async ({ page }) => {
    const w = world();
    await open(page, w, { role: 'role-x', permissions: ['users.view'] });
    await expect(page.getByText('Hind Alharbi').first()).toBeVisible();

    await expect(page.getByRole('note')).toContainText('View only');
    await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
    expect(w.requests.filter((r) => /^GET \/(roles|branches|warehouses)$/.test(r))).toEqual([]);
    await expect(page.getByText('Custom role').first()).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('Arabic renders RTL with isolated emails and no page overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { locale: 'ar' });
    await expect(page.getByRole('heading', { name: 'المستخدمون' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByText('كل الفروع').first()).toBeVisible();
    await expect(page.getByText('hind@acme.test').first()).toHaveAttribute('dir', 'ltr');
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-owner`);
  });

  test('keyboard: the row menu opens with Enter and closes with Escape returning focus', async ({ page }) => {
    const w = world();
    await open(page, w);
    await expect(page.getByText('Hind Alharbi').first()).toBeVisible();

    const trigger = rowOf(page, 'Hind Alharbi').getByRole('button', { name: 'More actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Remove' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});
