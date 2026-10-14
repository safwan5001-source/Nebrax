import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-03A — مساحة الأدوار في متصفح حقيقي: سطح مكتب 1440 + جوال 390، عربي/إنجليزي.
 * الخادم مُعترَض بحالة قابلة للتعديل؛ لا خلفية. نتحقق من: الشريط/المحدِّد، الكتالوج المجمَّع وتسمياته المترجمة،
 * «ممنوحة/غير ممنوحة» نصّاً، التصفية، العرض فقط، رفض الحذف دون «نجاح» كاذب، إعادة توجيه `/hr?tab=roles`،
 * وغياب التمرير الأفقي. اللقطات تُكتب فقط حين يُضبط `AC_UX03A_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX03A_SHOTS;

interface World {
  requests: string[];
  deleteStatus: 200 | 403;
}

const CATALOG = ['invoices.view', 'invoices.manage', 'users.view', 'users.manage', 'pos.audit.view', 'pos.audit.export', 'fuel.shift.view', 'fuel.shift.open'];
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'r2', slug: 'staff', name: 'Staff', permissions: ['invoices.view'], is_system: true, is_owner: false, users_count: 4 },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view', 'fuel.shift.view'], is_system: false, is_owner: false, users_count: 0 },
];

async function open(
  page: Page,
  w: World,
  opts: { locale?: 'ar' | 'en'; permissions?: string[]; role?: string; theme?: 'light' | 'dark'; path?: string } = {},
) {
  const locale = opts.locale ?? 'en';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    w.requests.push(`${method} ${path}`);
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/roles' && method === 'GET') return json(route, { data: ROLES, meta: { permissions: CATALOG } });
    if (/^\/roles\/[^/]+$/.test(path) && method === 'DELETE') {
      if (w.deleteStatus === 403) return json(route, { message: 'You cannot delete a role above your own permissions.' }, 403);
      return json(route, { message: 'deleted' });
    }
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    return json(route, { data: [] });
  });

  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${opts.path ?? '/roles'}`, { waitUntil: 'domcontentloaded' });
  // مؤشّر Next في وضع التطوير يعترض النقر على الجوال؛ ليس جزءاً من المنتج.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

/** اختيار دور: زر في الشريط على سطح المكتب، ومحدِّد منسدل على الجوال/اللوحي. */
const choose = async (page: Page, name: string, projectName: string) => {
  if (projectName === 'mobile') {
    await page.locator('#role-select').selectOption({ label: name });
  } else {
    await page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
  }
};

const world = (over: Partial<World> = {}): World => ({ requests: [], deleteStatus: 200, ...over });

test.describe('AC-UX-03A roles workspace', () => {
  test('shows the role catalogue grouped by module with text granted state and exact keys', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await expect(page.getByRole('heading', { name: 'Roles & permissions', level: 1 })).toBeVisible();

    await choose(page, 'Branch manager', info.project.name);
    const detail = page.getByRole('region', { name: 'Branch manager' });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Point of sale' })).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Fuel operations' })).toBeVisible(); // مجموعة لم تكن مترجَمة سابقاً
    await expect(detail.getByText('Not granted').first()).toBeVisible();
    await expect(page.getByText('role-ab12cd34')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-roles`);
  });

  test('search and "Granted only" narrow the catalogue', async ({ page }, info) => {
    const w = world();
    await open(page, w);
    await choose(page, 'Branch manager', info.project.name);
    const detail = page.getByRole('region', { name: 'Branch manager' });

    await detail.getByLabel('Search permissions…').fill('export');
    await expect(detail.getByRole('region', { name: 'Invoices' })).toHaveCount(0);
    await expect(detail.getByText('Audit — Export').first()).toBeVisible();

    await detail.getByLabel('Search permissions…').fill('');
    await detail.getByRole('switch', { name: 'Granted only' }).click();
    await expect(detail.getByText('Not granted')).toHaveCount(0);
  });

  test('a view-only viewer sees the catalogue but no create/edit/delete controls', async ({ page }, info) => {
    const w = world();
    await open(page, w, { role: 'role-x', permissions: ['roles.view'] });
    await expect(page.getByRole('note')).toContainText('View only');
    await choose(page, 'Branch manager', info.project.name);
    await expect(page.getByRole('region', { name: 'Branch manager' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete role' })).toHaveCount(0);
  });

  test('without roles.view the page says so and loads nothing', async ({ page }) => {
    const w = world();
    await open(page, w, { role: 'role-x', permissions: ['users.view'] });
    await expect(page.getByText("You don't have permission to view roles")).toBeVisible();
    expect(w.requests.filter((r) => r === 'GET /roles')).toEqual([]);
  });

  test('a refused delete shows the server message, no success toast, and the role stays', async ({ page }, info) => {
    const w = world({ deleteStatus: 403 });
    await open(page, w);
    await choose(page, 'Branch manager', info.project.name);
    const detail = page.getByRole('region', { name: 'Branch manager' });

    await detail.getByRole('button', { name: 'Delete role' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete role' }).click();
    await expect(page.getByText('You cannot delete a role above your own permissions.').first()).toBeVisible();
    await expect(page.getByText('Deleted successfully')).toHaveCount(0);
    await expect(detail).toBeVisible();
  });

  test('owner and system roles explain why they are locked', async ({ page }) => {
    const w = world();
    await open(page, w);
    const owner = page.getByRole('region', { name: 'Owner' });
    await expect(owner.getByText(/The owner role is protected/)).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Edit role' })).toBeDisabled();
  });

  test('the old HR roles tab link redirects to /roles', async ({ page }) => {
    const w = world();
    await open(page, w, { path: '/hr?tab=roles' });
    await expect(page).toHaveURL(/\/roles$/);
    await expect(page.getByRole('heading', { name: 'Roles & permissions', level: 1 })).toBeVisible();
  });

  test('Arabic renders RTL with translated modules, actions and areas and isolated keys', async ({ page }, info) => {
    const w = world();
    await open(page, w, { locale: 'ar' });
    await expect(page.getByRole('heading', { name: 'الأدوار والصلاحيات', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await choose(page, 'Branch manager', info.project.name);
    const detail = page.getByRole('region', { name: 'Branch manager' });
    await expect(detail.getByRole('region', { name: 'نقطة البيع' })).toBeVisible();
    await expect(detail.getByRole('region', { name: 'عمليات الوقود' })).toBeVisible();
    await expect(detail.getByText('ممنوحة').first()).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, `ar-${info.project.name}-roles`);
  });

  test('dark theme keeps the workspace legible without overflow', async ({ page }, info) => {
    const w = world();
    await open(page, w, { theme: 'dark' });
    await choose(page, 'Branch manager', info.project.name);
    await expect(page.getByRole('region', { name: 'Branch manager' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    await noHorizontalOverflow(page);
    await shot(page, `en-${info.project.name}-roles-dark`);
  });
});
