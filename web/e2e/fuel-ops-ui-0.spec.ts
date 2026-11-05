import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FUEL-OPS UI-0 — «تشغيل المحطات» في متصفح حقيقي (جوال 390×844 على هيئة آيفون + سطح مكتب 1440)،
 * عربي RTL / إنجليزي LTR، فاتح/داكن. الخادم مُعترَض بالكامل (لا خلفية ولا بيانات مستأجر حقيقية).
 *
 * يتحقق من: اتجاه الصفحة والتنقل السفلي، أهداف اللمس ≥ 44px، عدم تجاوز العرض الأفقي، خط الحقول ≥ 16px
 * (لا تكبير iOS)، `viewport-fit=cover`، تبديل المحطة يستبدل المحتوى كله، وأن المساحة **لا ترسل إلا GET**.
 * اللقطات تُكتب فقط حين يُضبط `UI0_SHOTS` (مجلد خارج المستودع). متصفح Chromium وليس WebKit، فهذا لا يغني عن اختبار
 * الجهاز الحقيقي (Safari) المطلوب قبل أي تفعيل.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.UI0_SHOTS;

const stations = [
  { id: 'sa', code: 'ST-A', name: 'Harbor Station', status: 'active', city: 'Dammam', region: 'Eastern', timezone: 'Asia/Riyadh', license_number: 'LIC-1', license_expires_at: '2027-01-01' },
  { id: 'sb', code: 'ST-B', name: 'Ridge Station', status: 'active', city: 'Riyadh', region: 'Riyadh', timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null },
];
const products = [
  { id: 'p1', code: 'P1', name: 'Alpha Grade', is_active: true },
  { id: 'p2', code: 'P2', name: 'Beta Grade', is_active: true },
  { id: 'p3', code: 'P3', name: 'Delta Grade', is_active: true },
];
const pumps = [
  { id: 'u1', fuel_station_id: 'sa', pump_number: '1', name: null, status: 'active' },
  { id: 'u2', fuel_station_id: 'sb', pump_number: '1', name: null, status: 'active' },
];
const tanks = [
  { id: 't1', fuel_station_id: 'sa', fuel_product_id: 'p1', code: 'T1', name: 'Tank One', capacity_milliliters: 30000000, minimum_level_milliliters: null, status: 'active' },
  { id: 't2', fuel_station_id: 'sa', fuel_product_id: 'p2', code: 'T2', name: 'Tank Two', capacity_milliliters: 20000000, minimum_level_milliliters: null, status: 'active' },
  { id: 't3', fuel_station_id: 'sb', fuel_product_id: 'p3', code: 'T3', name: 'Tank Three', capacity_milliliters: 25000000, minimum_level_milliliters: null, status: 'active' },
];
const nozzles = [
  { id: 'n1', fuel_station_id: 'sa', fuel_pump_id: 'u1', fuel_tank_id: 't1', fuel_product_id: 'p1', nozzle_number: '1', status: 'active' },
  { id: 'n2', fuel_station_id: 'sa', fuel_pump_id: 'u1', fuel_tank_id: 't2', fuel_product_id: 'p2', nozzle_number: '2', status: 'active' },
  { id: 'n3', fuel_station_id: 'sb', fuel_pump_id: 'u2', fuel_tank_id: 't3', fuel_product_id: 'p3', nozzle_number: '1', status: 'active' },
];
const prices = [
  { id: 'r1', fuel_station_id: 'sa', fuel_product_id: 'p1', price_per_liter_minor: 233, effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, status: 'active' },
  { id: 'r3', fuel_station_id: null, fuel_product_id: 'p3', price_per_liter_minor: 179, effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, status: 'active' },
];
const shifts = [
  { id: 'h1', number: 'SH-1001', status: 'open', station_id: 'sa', opening_float_minor: 0, operational_liters: '1250.5', cash_variance_minor: null, opened_at: '2026-11-04T05:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null },
];

async function open(page: Page, path: string, opts: { locale?: 'ar' | 'en'; theme?: 'light' | 'dark'; permissions?: string[] } = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: Array<{ method: string; path: string }> = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = {
    id: 'me', name: 'Sami', email: 'sami@acme.test', tenant_id: 't1', role: 'cashier', branch_ids: [], warehouse_ids: [],
    permissions: opts.permissions ?? ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view', 'fuel.shift.open', 'fuel.shift.approve'],
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push({ method: route.request().method(), path: p });
    const station = url.searchParams.get('station_id');
    if (p === '/me') return json(route, { user, company: { name: 'Acme Fuel' } });
    if (p === '/company') return json(route, { data: { name: 'Acme Fuel', logo: null } });
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/pumps') return json(route, { data: pumps });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/fuel-stations/nozzles') return json(route, { data: nozzles });
    if (p === '/fuel-stations/prices/effective') {
      // مصدر السعر الفعّال الوحيد منذ #2010: الخادم يحسم محطة ← افتراضي المؤسسة ← غير مضبوط.
      const rows = products.map((product) => {
        const hit = prices.find((r) => r.fuel_product_id === product.id && (r.fuel_station_id === station || r.fuel_station_id === null));
        return hit
          ? { fuel_product_id: product.id, fuel_station_id: station, status: 'effective', source: hit.fuel_station_id ? 'station_override' : 'tenant_default', price_per_liter_minor: hit.price_per_liter_minor, unit: 'L', tax_mode: 'tax_inclusive', effective_from: hit.effective_from, effective_until: null, sellable: true, blockers: [] }
          : { fuel_product_id: product.id, fuel_station_id: station, status: 'not_configured', source: null, price_per_liter_minor: null, unit: 'L', tax_mode: 'tax_inclusive', effective_from: null, effective_until: null, sellable: false, blockers: ['price_not_configured'] };
      });
      return json(route, { data: rows });
    }
    if (p === '/fuel-stations/prices') {
      const product = url.searchParams.get('fuel_product_id');
      return json(route, { data: prices.filter((r) => (!product || r.fuel_product_id === product) && (!station || r.fuel_station_id === station)), meta: { current_page: 1, last_page: 1 } });
    }
    if (p === '/fuel-stations/shifts') {
      return json(route, { data: shifts.filter((s) => (!station || s.station_id === station) && (!url.searchParams.get('status') || s.status === url.searchParams.get('status'))), meta: { current_page: 1, last_page: 1 } });
    }
    if (/^\/fuel-stations\/shifts\/[\w-]+$/.test(p)) return json(route, { data: { ...shifts[0], branch_id: null, operational_meter_milliliters: 0, locked_at: null, meter_readings: [], tank_readings: [], staff_assignments: [] } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    return json(route, { data: [] });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

for (const locale of ['ar', 'en'] as const) {
  test.describe(`Station Operations — ${locale}`, () => {
    test('home: direction, product list, bottom navigation, touch targets', async ({ page }, info) => {
      const requests = await open(page, '/fuel-stations/ops', { locale });
      await expect(page.getByText('Alpha Grade')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(await page.locator('[data-fuel-ops]').count()).toBe(1);
      expect(await noHorizontalOverflow(page)).toBe(true);
      expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');

      // أسعار من الخادم بالأرقام اللاتينية، و«غير مضبوط» لا يظهر صفراً.
      await expect(page.getByText(/2\.33/)).toBeVisible();
      await expect(page.getByText(locale === 'ar' ? 'السعر غير مضبوط' : 'Price not set')).toBeVisible();
      expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩]/);

      // أهداف اللمس ≥ 44px في التنقل والمحدّد.
      const targets = page.locator('nav a, #fo-station, header a');
      for (let i = 0; i < await targets.count(); i += 1) {
        const box = await targets.nth(i).boundingBox();
        if (box) { expect(box.height, `target ${i}`).toBeGreaterThanOrEqual(43.5); }
      }
      const fontSize = await page.locator('#fo-station').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);

      if (info.project.name === 'mobile') {
        const nav = await page.locator('nav[aria-label]').first().boundingBox();
        const viewport = page.viewportSize()!;
        expect(nav!.y + nav!.height).toBeGreaterThanOrEqual(viewport.height - 1); // التنقل ملتصق بأسفل الشاشة
        // الاتجاه: الشعار عند بداية السطر (يمين في RTL، يسار في LTR).
        const brand = await page.locator('header').getByText(locale === 'ar' ? 'محطات أَوْج' : 'AWJ Fuel Stations').boundingBox();
        if (locale === 'ar') expect(brand!.x).toBeGreaterThan(viewport.width / 3); else expect(brand!.x).toBeLessThan(viewport.width / 2);
      }

      // قراءة فقط: لا طلب غير GET إطلاقاً.
      expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
      if (shots) await page.screenshot({ path: `${shots}/ui0-home-${locale}-${info.project.name}.png`, fullPage: true });
    });

    test('switching stations replaces the whole scope', async ({ page }, info) => {
      await open(page, '/fuel-stations/ops', { locale });
      await expect(page.getByText('Alpha Grade')).toBeVisible();
      await page.locator('#fo-station').selectOption('sb');
      await expect(page.getByText('Delta Grade')).toBeVisible();
      await expect(page.getByText('Alpha Grade')).toHaveCount(0);
      await expect(page.getByText('Beta Grade')).toHaveCount(0);
      await expect(page.getByText(/1\.79/)).toBeVisible(); // سعر المؤسسة الافتراضي لمحطة بلا سعر خاص
      await expect(page.getByText('SH-1001')).toHaveCount(0); // وردية المحطة السابقة
      if (shots) await page.screenshot({ path: `${shots}/ui0-switched-${locale}-${info.project.name}.png`, fullPage: true });
    });

    test('products, shifts, settings and profile render without overflow', async ({ page }, info) => {
      for (const path of ['/fuel-stations/ops/products', '/fuel-stations/ops/shifts', '/fuel-stations/ops/settings', '/fuel-stations/ops/profile']) {
        await open(page, path, { locale });
        await expect(page.locator('h1')).toBeVisible();
        expect(await noHorizontalOverflow(page), path).toBe(true);
        if (shots) await page.screenshot({ path: `${shots}/ui0-${path.split('/').pop()}-${locale}-${info.project.name}.png`, fullPage: true });
      }
    });
  });
}

test('dark theme keeps the workspace legible and scoped', async ({ page }, info) => {
  await open(page, '/fuel-stations/ops', { locale: 'ar', theme: 'dark' });
  await expect(page.getByText('Alpha Grade')).toBeVisible();
  const colors = await page.evaluate(() => {
    const root = document.querySelector('[data-fuel-ops]') as HTMLElement;
    const style = getComputedStyle(root);
    return { isDark: document.documentElement.classList.contains('dark'), bg: style.backgroundColor, text: style.color };
  });
  expect(colors.isDark).toBe(true);
  expect(colors.bg).not.toBe('rgb(247, 248, 250)');
  if (shots) await page.screenshot({ path: `${shots}/ui0-home-dark-${info.project.name}.png`, fullPage: true });
});

test('a user without station permission is blocked and nothing fuel-related is requested', async ({ page }) => {
  const requests = await open(page, '/fuel-stations/ops', { locale: 'en', permissions: ['invoices.view'] });
  await expect(page.getByText("You don't have permission to view this")).toBeVisible();
  expect(requests.filter((r) => r.path.startsWith('/fuel-stations'))).toEqual([]);
});

test('home: the next step is inert text, there is ONE primary action, and every link stays inside the app', async ({ page }) => {
  await open(page, '/fuel-stations/ops', { locale: 'en' });
  const next = page.locator('[data-next-step]');
  await expect(next).toContainText('Record the starting meter readings');
  expect(await next.evaluate((el) => !!el.querySelector('a, button'))).toBe(false);
  await expect(page.locator('[data-primary-action]')).toHaveCount(1);
  const hrefs = await page.locator('a').evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((href) => !href.startsWith('#') && !href.startsWith('/fuel-stations/ops'))).toEqual([]);
});
