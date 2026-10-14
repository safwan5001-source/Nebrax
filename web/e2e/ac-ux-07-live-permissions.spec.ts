import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-07 — الصلاحيات المخزَّنة تُصحَّح من `/me` عند فتح الغلاف: سحبُ صلاحية أثناء الجلسة يُخفي الإجراءات
 * وروابط الشريط فوراً بلا إعادة دخول؛ وفشل `/me` أو استجابة لمستخدمٍ آخر لا يمسّ المخزَّن.
 * الخادم مُعترَض بالكامل؛ لا خلفية.
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

type Me = { status: number; user?: Record<string, unknown> };

async function open(page: Page, me: Me, locale: 'ar' | 'en' = 'en') {
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/users') {
      return json(route, { data: [{ id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'staff', is_active: true, employee_id: null, employee: null, branch_ids: [], warehouse_ids: [] }] });
    }
    if (path === '/me') return me.status === 200 ? json(route, { user: me.user, company: { name: 'Acme' } }) : json(route, { message: 'boom' }, me.status);
    if (path === '/roles') return json(route, { data: [] });
    return json(route, { data: [] });
  });

  const stored = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };
  await page.addInitScript((userJson) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
  }, JSON.stringify(stored));
  await page.goto(`${baseUrl}/users`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
}

const addUser = (page: Page) => page.getByRole('button', { name: /^(Add user|إضافة مستخدم)$/ });

test.describe('AC-UX-07 live permissions', () => {
  test('a permission revoked mid-session is applied from /me: actions and nav links disappear', async ({ page }) => {
    await open(page, { status: 200, user: { id: 'me', name: 'Safwan', role: 'role-x', permissions: ['users.view'] } });
    await expect(page.getByText('Hind Alharbi').locator('visible=true').first()).toBeVisible();
    await expect(addUser(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
    await expect(page.locator('a[href="/roles"]')).toHaveCount(0); // roles.view سُحبت
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('user')!).permissions)).toEqual(['users.view']);
  });

  test('a failing /me leaves the stored permissions untouched', async ({ page }) => {
    await open(page, { status: 500 });
    await expect(addUser(page)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).permissions)).toEqual(['*']);
  });

  test('a /me answer for another user is never adopted', async ({ page }) => {
    await open(page, { status: 200, user: { id: 'someone-else', name: 'X', role: 'staff', permissions: [] } });
    await expect(addUser(page)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('user')!).permissions)).toEqual(['*']);
  });

  test('Arabic: the revoked state renders RTL and keeps the read-only note', async ({ page }) => {
    await open(page, { status: 200, user: { id: 'me', name: 'Safwan', role: 'role-x', permissions: ['users.view'] } }, 'ar');
    await expect(page.getByText('Hind Alharbi').locator('visible=true').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByRole('note')).toBeVisible();
    await expect(addUser(page)).toHaveCount(0);
  });
});
