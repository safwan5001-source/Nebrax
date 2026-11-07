import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * AWJ SMART GUIDE — الجولة التفاعلية في تطبيق «محطات أَوْج» في متصفح حقيقي (جوال 390×844 على هيئة آيفون + سطح مكتب)،
 * عربي RTL / إنجليزي LTR، فاتح/داكن، وتقليل الحركة. الخادم مُعترَض بالكامل.
 * متصفح Chromium وليس WebKit: لا يغني عن اختبار Safari على آيفون حقيقي (انظر قائمة التحقق).
 * اللقطات تُكتب فقط حين يُضبط `GUIDE_SHOTS`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const shots = process.env.GUIDE_SHOTS;

const stations = [{ id: 'sa', code: 'ST-A', name: 'Harbor Station', status: 'active', city: 'Dammam', region: 'Eastern', timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null }];
const products = [{ id: 'p1', code: 'P1', name: 'Alpha Grade', is_active: true }, { id: 'p2', code: 'P2', name: 'Beta Grade', is_active: true }];
const pumps = [{ id: 'u1', fuel_station_id: 'sa', pump_number: '1', name: null, status: 'active' }];
const tanks = [
  { id: 't1', fuel_station_id: 'sa', fuel_product_id: 'p1', code: 'T1', name: 'Tank One', capacity_milliliters: 30000000, minimum_level_milliliters: null, status: 'active' },
  { id: 't2', fuel_station_id: 'sa', fuel_product_id: 'p2', code: 'T2', name: 'Tank Two', capacity_milliliters: 20000000, minimum_level_milliliters: null, status: 'active' },
];
const nozzles = [
  { id: 'n1', fuel_station_id: 'sa', fuel_pump_id: 'u1', fuel_tank_id: 't1', fuel_product_id: 'p1', nozzle_number: '1', status: 'active' },
  { id: 'n2', fuel_station_id: 'sa', fuel_pump_id: 'u1', fuel_tank_id: 't2', fuel_product_id: 'p2', nozzle_number: '2', status: 'active' },
];
const shifts = [{ id: 'h1', number: 'SH-1001', status: 'open', station_id: 'sa', opening_float_minor: 0, operational_liters: '1250.5', cash_variance_minor: null, opened_at: '2026-11-04T05:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null }];

interface Options { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[]; userId?: string; force?: boolean }

async function open(page: Page, path: string, opts: Options = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: Array<{ method: string; path: string }> = [];
  const current = { id: opts.userId ?? 'me' };
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = {
    id: 'placeholder', name: 'Sami', email: 'sami@acme.test', tenant_id: 't1', role: 'cashier', branch_ids: [], warehouse_ids: [],
    permissions: opts.permissions ?? ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view', 'fuel.shift.open'],
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push({ method: route.request().method(), path: p });
    const station = url.searchParams.get('station_id');
    if (p === '/me') return json(route, { user: { ...user, id: current.id }, company: { name: 'Acme Fuel' } });
    if (p === '/company') return json(route, { data: { name: 'Acme Fuel', logo: null } });
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/pumps') return json(route, { data: pumps });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/fuel-stations/tank-levels') {
      return json(route, { data: tanks.map((t) => ({
        tank: { id: t.id, code: t.code, name: t.name, status: t.status, capacity_milliliters: t.capacity_milliliters, capacity_liters: String(t.capacity_milliliters / 1000), safe_capacity_milliliters: t.capacity_milliliters, minimum_level_milliliters: 0, dead_stock_milliliters: 0 },
        station: { id: 'sa', code: 'ST-A', name: 'Harbor Station' },
        fuel_product: { id: t.fuel_product_id, code: null, name: null },
        latest: null,
        latest_by_type: { physical: null, atg: null },
        level: { fill_basis_points: null, available_milliliters: null, available_liters: null, safe_available_milliliters: null, age_seconds: null, freshness: 'none', stale_after_minutes: null, flags: [], needs_review: false },
      })), meta: { generated_at: null } });
    }
    if (p === '/fuel-stations/nozzles') return json(route, { data: nozzles });
    if (p === '/fuel-stations/prices/effective') {
      return json(route, { data: products.map((product) => ({ fuel_product_id: product.id, fuel_station_id: station, status: 'effective', source: 'tenant_default', price_per_liter_minor: 233, unit: 'L', tax_mode: 'tax_inclusive', effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, sellable: true, blockers: [] })) });
    }
    if (p === '/fuel-stations/shifts') return json(route, { data: shifts.filter((s) => !station || s.station_id === station), meta: { current_page: 1, last_page: 1 } });
    if (/^\/fuel-stations\/shifts\/[\w-]+$/.test(p)) return json(route, { data: { ...shifts[0], branch_id: null, operational_meter_milliliters: 0, locked_at: null, meter_readings: [], tank_readings: [], staff_assignments: [] } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme, force]) => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem('token', 'test-token');
      localStorage.setItem('station_use_erp', JSON.parse(userJson).id);
      localStorage.setItem('user', userJson);
      localStorage.setItem('theme', theme);
      if (force) localStorage.setItem('awj.station-guide.force', '1');
      sessionStorage.setItem('__seeded', '1');
    }
  }, [JSON.stringify({ ...user, id: current.id }), opts.theme ?? 'light', opts.force ?? true] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return Object.assign(requests, { setUserId: (id: string) => { current.id = id; } });
}

const overlay = (page: Page) => page.locator('[data-smart-guide]');
const card = (page: Page) => page.locator('[data-guide-card]');
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const locale of ['ar', 'en'] as const) {
  const L = {
    next: locale === 'ar' ? 'التالي' : 'Next',
    prev: locale === 'ar' ? 'السابق' : 'Back',
    skip: locale === 'ar' ? 'تخطي الجولة' : 'Skip tour',
    done: locale === 'ar' ? 'إنهاء الجولة' : 'Finish tour',
    replay: locale === 'ar' ? 'إعادة الجولة' : 'Replay tour',
    startHere: locale === 'ar' ? 'ابدأ جولة هذه الشاشة' : 'Start this screen’s tour',
    contextual: locale === 'ar' ? 'مساعدة هذه الشاشة' : 'Help for this screen',
  };

  test.describe(`Smart Guide — ${locale}`, () => {
    test('first login starts the welcome tour; the spotlight sits on the REAL element and the card never covers it', async ({ page }, info) => {
      const requests = await open(page, '/fuel-stations/ops', { locale });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      await shot(page, `guide-1-intro-${locale}-${info.project.name}`);

      await card(page).getByRole('button', { name: L.next }).click();
      const spot = page.locator('[data-guide-spotlight]');
      await expect(spot).toBeVisible();
      await page.waitForTimeout(450); // انتهاء الانتقال الناعم
      const target = (await page.locator('#fo-station').boundingBox())!;
      const spotBox = (await spot.boundingBox())!;
      expect(Math.abs(spotBox.x - (target.x - 8))).toBeLessThan(3);
      expect(Math.abs(spotBox.y - (target.y - 8))).toBeLessThan(3);
      const cardBox = (await card(page).boundingBox())!;
      expect(intersects(cardBox, target), 'card must not cover the highlighted element').toBe(false);
      const viewport = page.viewportSize()!;
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(await noHorizontalOverflow(page)).toBe(true);
      for (const button of await card(page).getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      await shot(page, `guide-2-station-${locale}-${info.project.name}`);

      // اجتز كل الخطوات: كل خطوة مبرَزة داخل الشاشة وبلا تغطية.
      let guard = 0;
      while (await card(page).getByRole('button', { name: L.next }).count() && guard < 12) {
        guard += 1;
        await card(page).getByRole('button', { name: L.next }).click();
        await page.waitForTimeout(350);
        if (await spot.count()) {
          const s = (await spot.boundingBox())!;
          const c = (await card(page).boundingBox())!;
          expect(c.y + c.height, `step ${guard}`).toBeLessThanOrEqual(viewport.height + 0.5);
          if (info.project.name === 'mobile') expect(intersects(c, { x: s.x + 8, y: s.y + 8, width: s.width - 16, height: s.height - 16 }), `step ${guard} card covers target`).toBe(false);
        }
        if (guard === 5) await shot(page, `guide-6-nav-${locale}-${info.project.name}`);
      }
      await shot(page, `guide-8-done-${locale}-${info.project.name}`);
      await card(page).getByRole('button', { name: L.done }).click();
      await expect(overlay(page)).toHaveCount(0);

      // لا إجراء تشغيلي: الجولة لم ترسل أي طلب غير GET.
      expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

      // لا تعود بعد الإكمال.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await expect(overlay(page)).toHaveCount(0);
    });

    test('skip is remembered; the tour can be replayed from the Help Center and resumes where it stopped', async ({ page }) => {
      await open(page, '/fuel-stations/ops', { locale });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      await card(page).getByRole('button', { name: L.next }).click();
      await card(page).getByRole('button', { name: L.skip }).click();
      await expect(overlay(page)).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await expect(overlay(page)).toHaveCount(0);

      await page.goto(`${baseUrl}/fuel-stations/ops/help`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('[data-guide-panel] [data-tour="welcome"]');
      await expect(row).toHaveAttribute('data-tour-status', 'skipped');
      await row.getByRole('button', { name: L.replay }).click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops$/);
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      await expect(card(page)).toContainText(locale === 'ar' ? 'مرحباً بك' : 'Welcome');
    });

    test('while the tour is on, the real button still works (nothing is blocked) and leaving the screen pauses the tour', async ({ page }) => {
      await open(page, '/fuel-stations/ops', { locale });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      // الغلاف لا يلتقط اللمس، فيصل النقر إلى الرابط الحقيقي تحته.
      expect(await overlay(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
      await page.locator('a[href="/fuel-stations/ops/shifts"]').first().click();
      await expect(page).toHaveURL(/\/fuel-stations\/ops\/shifts$/);
      await expect(overlay(page)).toHaveCount(0);
      const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('awj.station-guide.v1.')).map(([, v]) => JSON.parse(v)));
      expect(saved[0].welcome.status).toBe('in_progress');
    });

    test('reduced motion: no animated transitions on the spotlight or the card', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, '/fuel-stations/ops', { locale });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      await card(page).getByRole('button', { name: L.next }).click();
      const spot = page.locator('[data-guide-spotlight]');
      await expect(spot).toBeVisible();
      expect(await spot.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none');
      expect(await card(page).evaluate((el) => Math.max(...getComputedStyle(el).transitionDuration.split(',').map((v) => parseFloat(v))))).toBeLessThanOrEqual(0.001);
    });

    test('permissions decide what is explained: no receiving step without a receiving permission', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops/tanks', { locale, force: false });
      await page.getByRole('button', { name: L.contextual }).click();
      await page.getByRole('button', { name: L.startHere }).click();
      await expect(card(page)).toBeVisible({ timeout: 10_000 });
      await expect(card(page)).toContainText(locale === 'ar' ? 'من 3' : 'of 3'); // levels، tank، recordReading
      expect(await page.locator('nav a[href="/fuel-stations/ops/receiving"]').count()).toBe(0);
      await shot(page, `guide-stock-${locale}-${info.project.name}`);
    });
  });

  test.describe(`Smart Guide with receiving permission — ${locale}`, () => {
    test('the receiving step appears only when the nav item exists', async ({ page }) => {
      await open(page, '/fuel-stations/ops/tanks', { locale, force: false, permissions: ['fuel_stations.view', 'fuel.shift.view', 'fuel.delivery.view'] });
      await page.getByRole('button', { name: L.contextual }).click();
      await page.getByRole('button', { name: L.startHere }).click();
      await expect(card(page)).toContainText(locale === 'ar' ? 'من 4' : 'of 4');
    });
  });

  test.describe(`Smart Guide dark — ${locale}`, () => {
    test('dark theme', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops', { locale, theme: 'dark' });
      await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
      await card(page).getByRole('button', { name: L.next }).click();
      await page.waitForTimeout(450);
      expect(await noHorizontalOverflow(page)).toBe(true);
      await shot(page, `guide-dark-${locale}-${info.project.name}`);
    });
  });
}

test('a second employee on the same device gets their own tour', async ({ page }) => {
  const session = await open(page, '/fuel-stations/ops', { locale: 'en', userId: 'emp-1' });
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await card(page).getByRole('button', { name: 'Skip tour' }).click();
  session.setUserId('emp-2');
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user')!), id: 'emp-2' }));
    localStorage.setItem('station_use_erp', 'emp-2'); // اعتماد التطبيق مرتبط بمعرّف المستخدم الحالي
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-smart-guide]')).toBeVisible({ timeout: 10_000 });
});
