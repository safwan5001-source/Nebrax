import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FUEL HELP CENTER V1 — مركز المساعدة في تطبيق «محطات أَوْج» (جوال 390×844 على هيئة آيفون + سطح مكتب) وفي وحدة ERP،
 * عربي RTL / إنجليزي LTR، فاتح/داكن. الخادم مُعترَض بالكامل؛ المحتوى ثابت ولا يحتاج خلفية.
 * اللقطات تُكتب فقط حين يُضبط `HELP_SHOTS`. متصفح Chromium وليس WebKit: لا يغني عن اختبار Safari على آيفون حقيقي.
 *   npx next build && npx next start -p 3012 &
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 HELP_SHOTS=/tmp/shots npx playwright test -c playwright.fuel-ops.config.ts fuel-help-center
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const shots = process.env.HELP_SHOTS;

const stations = [{ id: 'sa', code: 'ST-A', name: 'Harbor Station', status: 'active', city: 'Dammam', region: 'Eastern', timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null }];

async function open(page: Page, path: string, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[] } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: Array<{ method: string; path: string }> = [];
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = {
    id: 'me', name: 'Sami', email: 'sami@acme.test', tenant_id: 't1', role: 'cashier', branch_ids: [], warehouse_ids: [],
    permissions: opts.permissions ?? ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'],
  };
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    requests.push({ method: route.request().method(), path: p });
    if (p === '/me') return json(route, { user, company: { name: 'Acme Fuel' } });
    if (p === '/company') return json(route, { data: { name: 'Acme Fuel', logo: null } });
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/applications/nav-state') return json(route, { data: {} });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('station_use_erp', JSON.parse(userJson).id);
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); };

for (const locale of ['ar', 'en'] as const) {
  const L = {
    searchPlaceholder: locale === 'ar' ? /ابحث/ : /Search/,
    contextual: locale === 'ar' ? 'مساعدة هذه الشاشة' : 'Help for this screen',
    helpNav: locale === 'ar' ? 'المساعدة' : 'Help',
    openShiftTitle: locale === 'ar' ? 'فتح وردية جديدة' : 'Open a new shift',
    startGuide: locale === 'ar' ? 'ابدأ الدليل التفاعلي' : 'Start interactive guide',
    next: locale === 'ar' ? 'التالي' : 'Next',
  };

  test.describe(`Fuel help — Station Operations app — ${locale}`, () => {
    test('help is in the main menu, searchable, and every target is touch-sized', async ({ page }, info) => {
      const requests = await open(page, '/fuel-stations/ops', { locale });
      await page.locator('nav[aria-label] a', { hasText: L.helpNav }).click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/help$/);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `help-home-${locale}-${info.project.name}`);

      const search = page.getByRole('searchbox');
      expect(await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16); // لا تكبير iOS
      await search.fill(locale === 'ar' ? 'فتح وردية' : 'open shift');
      const first = page.locator('main ul a').first();
      await expect(first).toContainText(L.openShiftTitle);
      const box = await first.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await shot(page, `help-search-${locale}-${info.project.name}`);

      // المحتوى ثابت: لا طلب غير GET ولا أي طلب خاص بالمساعدة.
      expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
      expect(requests.some((r) => /help/i.test(r.path))).toBe(false);
    });

    test('a guide page shows steps/permissions/errors and the interactive guide walks step by step', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops/help/fuel-open-shift', { locale });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(L.openShiftTitle);
      await expect(page.getByText('fuel.shift.open').first()).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `help-article-${locale}-${info.project.name}`);

      await page.getByRole('button', { name: L.startGuide }).first().click();
      const guide = page.getByRole('region', { name: locale === 'ar' ? 'الدليل التفاعلي' : 'Interactive guide' });
      await expect(guide).toBeVisible();
      const next = guide.getByRole('button', { name: L.next });
      expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(47);
      await next.click();
      await expect(guide.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow', '0');
      await shot(page, `help-guide-${locale}-${info.project.name}`);

      // لا رابط يغادر التطبيق.
      for (const href of await page.locator('main a').evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))) {
        expect(href.startsWith('/fuel-stations/ops'), href).toBe(true);
      }
    });

    test('contextual help on the open-shift screen opens a sheet for that screen', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops/shifts/open', { locale });
      const trigger = page.getByRole('button', { name: L.contextual });
      await expect(trigger).toBeVisible();
      expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(43.5);
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(L.openShiftTitle);
      expect(await dialog.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `help-contextual-${locale}-${info.project.name}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });

  test.describe(`Fuel help — dark theme — ${locale}`, () => {
    test('dark theme renders the center without overflow', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops/help', { locale, theme: 'dark' });
      await expect(page.getByRole('searchbox')).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `help-home-dark-${locale}-${info.project.name}`);
    });
  });

  test.describe(`Fuel help — ERP Stations module — ${locale}`, () => {
    test('the module menu links the same help center and shows its screen-linked guides', async ({ page }, info) => {
      await open(page, '/fuel-stations/help', { locale });
      await expect(page.getByRole('searchbox')).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `help-erp-home-${locale}-${info.project.name}`);

      await page.goto(`${baseUrl}/fuel-stations/help/fuel-tanks-pumps-nozzles`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main a[href="/fuel-stations/master-data"]')).toBeVisible();
      await shot(page, `help-erp-article-${locale}-${info.project.name}`);

      await page.goto(`${baseUrl}/fuel-stations/master-data`, { waitUntil: 'domcontentloaded' });
      const trigger = page.getByRole('button', { name: L.contextual });
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `help-erp-contextual-${locale}-${info.project.name}`);
    });
  });
}
