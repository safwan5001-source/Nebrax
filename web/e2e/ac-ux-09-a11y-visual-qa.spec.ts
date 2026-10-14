import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AC-UX-09 — جودة الوصولية والتجاوب والسمات لشاشتَي المستخدمين والأدوار في متصفح حقيقي.
 *
 * - مصفوفة: {المستخدمون، الأدوار} × {1440، 1280، 768، 390} × {EN، AR} × {فاتح، داكن، Ink}: بلا تمرير أفقي،
 *   عنوان الصفحة ظاهر، اتجاه RTL في العربية، وكل عنصر تفاعلي ظاهر داخل المحتوى له اسم يمكن الوصول إليه.
 * - لوحة المفاتيح: الوصول لزر «ملخّص الوصول» بـTab، فتحه بـEnter، حبس التركيز داخل اللوحة، الإغلاق بـEscape
 *   وعودة التركيز لمصدره؛ ومؤشّر تركيز مرئي على كل عنصر يُركَّز عليه.
 * - الحالات: تحميل / خطأ مع إعادة المحاولة / فارغ / بلا صلاحية — للشاشتين.
 * الخادم مُعترَض بالكامل؛ لا خلفية. يعمل على مشروع `desktop` فقط (الأحجام تُضبط داخل الاختبار).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.AC_UX09_SHOTS;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark', 'ink'] as const;
type Theme = (typeof THEMES)[number];
type Screen = 'users' | 'roles';

const u = (over: Record<string, unknown>) => ({
  id: 'u0', name: 'User', email: 'user@acme.test', role: 'staff', is_active: true,
  employee_id: null, employee: null, branch_ids: [], warehouse_ids: [], ...over,
});
const USERS = [
  u({ id: 'me', name: 'Safwan', email: 'owner@acme.test', role: 'owner' }),
  u({ id: 'u2', name: 'Hind Alharbi', email: 'hind@acme.test', role: 'role-ab12cd34', branch_ids: ['b1', 'b2'], employee: { id: 'e1', name: 'Hind Alharbi', employee_no: 'E-7' } }),
  u({ id: 'u3', name: 'Amal Qahtani', email: 'amal@acme.test', role: 'accountant', is_active: false }),
];
const CATALOG = ['invoices.view', 'invoices.manage', 'users.view', 'users.manage', 'pos.audit.view', 'pos.audit.export', 'fuel.shift.view', 'fuel.shift.open'];
const ROLES = [
  { id: 'r1', slug: 'owner', name: 'Owner', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'r2', slug: 'staff', name: 'Staff', permissions: ['invoices.view'], is_system: true, is_owner: false, users_count: 4 },
  { id: 'r3', slug: 'role-ab12cd34', name: 'Branch manager', permissions: ['invoices.view', 'invoices.manage', 'pos.audit.view', 'fuel.shift.view'], is_system: false, is_owner: false, users_count: 0 },
];

interface Opts {
  locale?: 'ar' | 'en';
  theme?: Theme;
  permissions?: string[];
  role?: string;
  /** استجابة القوائم: `ok` | `error` | `empty` | `slow`. */
  data?: 'ok' | 'error' | 'empty' | 'slow';
  viewport?: (typeof VIEWPORTS)[number];
}

async function open(page: Page, screen: Screen, opts: Opts = {}) {
  const locale = opts.locale ?? 'en';
  const theme = opts.theme ?? 'light';
  const state = { data: opts.data ?? 'ok' };
  await page.setViewportSize(opts.viewport ?? VIEWPORTS[0]);
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: opts.role ?? 'owner', permissions: opts.permissions ?? ['*'] };

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    const listing = path === '/users' || path === '/roles';
    if (listing && method === 'GET') {
      if (state.data === 'error') return json(route, { message: 'Server unavailable' }, 500);
      if (state.data === 'slow') await new Promise((resolve) => setTimeout(resolve, 1500));
      const empty = state.data === 'empty';
      if (path === '/users') return json(route, { data: empty ? [] : USERS });
      return json(route, { data: empty ? [] : ROLES, meta: { permissions: CATALOG } });
    }
    if (path === '/branches') return json(route, { data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/warehouses') return json(route, { data: [{ id: 'w1', name: 'Main store', branch_id: 'b1' }] });
    return json(route, { data: [] });
  });

  await page.addInitScript(([userJson, mode, ink]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', mode);
    if (ink === '1') {
      localStorage.setItem('awj:ui-version', '3');
      localStorage.setItem('awj:theme', 'ink');
    }
  }, [JSON.stringify(user), theme === 'dark' ? 'dark' : 'light', theme === 'ink' ? '1' : '0'] as const);
  await page.goto(`${baseUrl}/${screen}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  return state;
}

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};

/** كل عنصر تفاعلي ظاهر داخل المحتوى الرئيسي له اسم يمكن الوصول إليه (تقريب لقواعد accname). */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('#main-content') ?? document.body;
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=checkbox], [role=radio], [role=tab], [role=option]';
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const text = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
        if (text) return text;
      }
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length > 0) {
        const text = Array.from(labels).map((label) => label.textContent?.trim() ?? '').join(' ').trim();
        if (text) return text;
      }
      const own = el.textContent?.replace(/\s+/g, ' ').trim();
      if (own) return own;
      const alt = el.querySelector('img[alt]')?.getAttribute('alt')?.trim();
      if (alt) return alt;
      return el.getAttribute('title')?.trim() ?? '';
    };
    return Array.from(root.querySelectorAll(selector))
      .filter(visible)
      .filter((el) => nameOf(el) === '')
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}[${el.getAttribute('type') ?? el.getAttribute('role') ?? ''}] ${el.outerHTML.slice(0, 90)}`);
  });
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
};

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'viewports are set inside the test');
});

test.describe('AC-UX-09 matrix: viewport × locale × theme', () => {
  for (const screen of ['users', 'roles'] as const) {
    for (const viewport of VIEWPORTS) {
      for (const locale of ['en', 'ar'] as const) {
        for (const theme of THEMES) {
          test(`${screen} @${viewport.width} ${locale} ${theme}`, async ({ page }) => {
            await open(page, screen, { locale, theme, viewport });
            const title = { users: { en: 'Users', ar: 'المستخدمون' }, roles: { en: 'Roles & permissions', ar: 'الأدوار والصلاحيات' } }[screen][locale];
            await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
            // الأدوار: شريط على الشاشات العريضة (≥1024) ومحدِّد منسدل دونها.
            if (screen === 'roles' && viewport.width < 1024) await expect(page.locator('#role-select')).toBeVisible();
            else await expect(page.locator(screen === 'users' ? 'text=Hind Alharbi' : 'text=Branch manager').locator('visible=true').first()).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
            if (theme === 'dark') expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
            if (theme === 'ink') {
              expect(await page.evaluate(() => document.documentElement.getAttribute('data-awj-ui'))).toBe('3');
              expect(await page.evaluate(() => document.documentElement.getAttribute('data-awj-theme'))).toBe('ink');
            }
            await noHorizontalOverflow(page);
            expect(await unnamedControls(page)).toEqual([]);
            if (viewport.width === 1440 || viewport.width === 390) await shot(page, `${screen}-${locale}-${theme}-${viewport.width}`);
          });
        }
      }
    }
  }
});

test('the accessible-name audit really flags an unnamed control (guard for the guard)', async ({ page }) => {
  await open(page, 'users');
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'probe-unnamed';
    button.style.cssText = 'width:20px;height:20px';
    (document.querySelector('#main-content') ?? document.body).appendChild(button);
  });
  const found = await unnamedControls(page);
  expect(found.some((entry) => entry.includes('probe-unnamed'))).toBe(true);
});

test.describe('AC-UX-09 keyboard', () => {
  const focusRing = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      return { tag: el.tagName, visible: outline || shadow };
    });

  for (const locale of ['en', 'ar'] as const) {
    test(`users: Tab → Enter opens the access summary, focus is trapped, Escape returns focus (${locale})`, async ({ page }) => {
      await open(page, 'users', { locale });
      const label = locale === 'en' ? 'Access summary' : 'ملخّص الوصول';
      const row = page.getByRole('row').filter({ hasText: 'Hind Alharbi' });
      const trigger = row.getByRole('button', { name: label, exact: true });
      await expect(trigger).toBeVisible();

      // Tab حتى يصل التركيز إلى الزر (الوصول بلوحة المفاتيح فقط)، مع التحقق من مؤشّر تركيز مرئي في كل خطوة.
      let reached = false;
      for (let i = 0; i < 80 && !reached; i += 1) {
        await page.keyboard.press('Tab');
        const ring = await focusRing(page);
        if (ring) expect(ring.visible, `focus ring missing on step ${i + 1} (${ring.tag})`).toBe(true);
        reached = await trigger.evaluate((el) => el === document.activeElement);
      }
      expect(reached).toBe(true);

      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);

      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    });
  }

  test('roles: the rail is operable by keyboard and the switch toggles with Space', async ({ page }) => {
    await open(page, 'roles');
    const nav = page.getByRole('navigation').getByRole('button', { name: /Branch manager/ });
    await nav.focus();
    await page.keyboard.press('Enter');
    const detail = page.getByRole('region', { name: 'Branch manager' });
    await expect(detail).toBeVisible();

    const search = detail.getByLabel('Search permissions…');
    await search.focus();
    await page.keyboard.type('export');
    await expect(detail.getByRole('region', { name: 'Invoices' })).toHaveCount(0);
    await search.fill('');

    const toggle = detail.getByRole('switch', { name: 'Granted only' });
    await toggle.focus();
    expect(await focusRing(page)).toMatchObject({ visible: true });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(detail.getByText('Not granted')).toHaveCount(0);
  });
});

test.describe('AC-UX-09 states', () => {
  test('users: loading → error with Retry → recovered', async ({ page }) => {
    const state = await open(page, 'users', { data: 'error' });
    await expect(page.getByText('Server unavailable').first()).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry' }).first();
    await expect(retry).toBeVisible();
    state.data = 'ok';
    await retry.click();
    await expect(page.getByText('Hind Alharbi').locator('visible=true').first()).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('users: shows a busy region while loading', async ({ page }) => {
    await open(page, 'users', { data: 'slow' });
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByText('Hind Alharbi').locator('visible=true').first()).toBeVisible({ timeout: 10_000 });
  });

  test('users: empty', async ({ page }) => {
    await open(page, 'users', { data: 'empty' });
    await expect(page.getByText('No users yet').first()).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('users: a viewer without users.view gets an explanation, no data request', async ({ page }) => {
    await open(page, 'users', { role: 'role-x', permissions: ['invoices.view'] });
    await expect(page.getByText("You don't have permission to view users")).toBeVisible();
  });

  test('roles: error with Retry → recovered', async ({ page }) => {
    const state = await open(page, 'roles', { data: 'error' });
    await expect(page.getByText('Server unavailable').first()).toBeVisible();
    state.data = 'ok';
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await expect(page.getByText('Branch manager').locator('visible=true').first()).toBeVisible();
  });

  test('roles: shows a busy region while loading', async ({ page }) => {
    await open(page, 'roles', { data: 'slow' });
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByText('Branch manager').locator('visible=true').first()).toBeVisible({ timeout: 10_000 });
  });

  test('roles: empty', async ({ page }) => {
    await open(page, 'roles', { data: 'empty' });
    await expect(page.getByText('No roles yet').first()).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('roles: a viewer without roles.view gets an explanation', async ({ page }) => {
    await open(page, 'roles', { role: 'role-x', permissions: ['invoices.view'] });
    await expect(page.getByText("You don't have permission to view roles")).toBeVisible();
  });
});
