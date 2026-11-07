import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FUEL-OPS UI-0 — الفحص البصري (مواصفة #1990 §7). ينتج لقطات متصفح حقيقية لمصفوفة (شاشة × مقاس × ثيم × لغة) وحالات البيانات،
 * ولقطات النموذج المرجعي المعتمد بالمقاسات نفسها، ويفحص آلياً: تجاوز العرض الأفقي، أهداف اللمس، تغطية التنقل السفلي لآخر عنصر،
 * خط الحقول، غياب ودجت Next، وأخطاء الكونسول. الأحكام البصرية (التطابق مع المرجع) يكتبها المراجع في VISUAL_QA_REPORT.md؛ هذا الملف
 * لا يدّعي PASS بصرياً. الخادم مُعترَض؛ أسماء المحطات والمنتجات **بيانات اختبار** موسومة (Fixture) لا بيانات مستأجر.
 */
const OUT = process.env.VQA_OUT;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3012';
const REFERENCE = process.env.VQA_REFERENCE_HTML; // مسار ملف النموذج المرجعي
test.skip(!OUT, 'VQA_OUT is required');

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 812 }, { w: 390, h: 844 }, { w: 414, h: 896 }, { w: 430, h: 932 },
] as const;
const SCREENS = ['', '/products', '/shifts', '/settings', '/profile'] as const;
const screenName = (path: string) => (path === '' ? 'home' : path.slice(1));

type Locale = 'ar' | 'en';
type Scenario = 'default' | 'no-shift' | 'no-products' | 'no-price' | 'forbidden' | 'server-error' | 'offline' | 'loading' | 'no-perms';

function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'مستخدم تجريبي' : 'Fixture User',
    stations: [ar ? 'محطة تجريبية أ' : 'Fixture Station A', ar ? 'محطة تجريبية ب' : 'Fixture Station B'],
    products: ar ? ['وقود تجريبي 1', 'وقود تجريبي 2', 'وقود تجريبي 3'] : ['Fixture Fuel 1', 'Fixture Fuel 2', 'Fixture Fuel 3'],
  };
}

async function open(page: Page, path: string, opts: { locale: Locale; theme: 'light' | 'dark'; scenario?: Scenario; viewport: { w: number; h: number } }) {
  const scenario = opts.scenario ?? 'default';
  const n = names(opts.locale);
  const issues: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/INVALID_KEY|Namespace keys|Failed to load resource/.test(m.text())) issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  await page.setViewportSize({ width: opts.viewport.w, height: opts.viewport.h });
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const perms = scenario === 'no-perms' ? ['invoices.view'] : ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view', 'fuel.shift.open', 'fuel.shift.approve'];
  const user = { id: 'fx-user', name: n.user, email: 'fixture@example.test', tenant_id: 'fx-tenant', role: 'cashier', branch_ids: [], warehouse_ids: [], permissions: perms };
  const stations = [
    { id: 'sa', code: 'FX-A', name: n.stations[0], status: 'active', city: opts.locale === 'ar' ? 'الدمام' : 'Dammam', region: opts.locale === 'ar' ? 'الشرقية' : 'Eastern', timezone: 'Asia/Riyadh', license_number: 'FX-LIC-1', license_expires_at: '2027-01-01' },
    { id: 'sb', code: 'FX-B', name: n.stations[1], status: 'active', city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null },
  ];
  const products = n.products.map((name, i) => ({ id: `p${i + 1}`, code: `FX${i + 1}`, name, is_active: true }));
  const pumps = [1, 2, 3].map((i) => ({ id: `u${i}`, fuel_station_id: 'sa', pump_number: String(i), name: null, status: 'active' }));
  const tanks = products.map((p, i) => ({ id: `t${i + 1}`, fuel_station_id: 'sa', fuel_product_id: p.id, code: `T${i + 1}`, name: opts.locale === 'ar' ? `خزان ${i + 1}` : `Tank ${i + 1}`, capacity_milliliters: (30 - i * 5) * 1_000_000, minimum_level_milliliters: null, status: 'active' }));
  const nozzles = products.flatMap((p, i) => [1, 2].map((k) => ({ id: `n${i}${k}`, fuel_station_id: 'sa', fuel_pump_id: `u${i + 1}`, fuel_tank_id: `t${i + 1}`, fuel_product_id: p.id, nozzle_number: String(k), status: 'active' })));
  const prices = scenario === 'no-price' ? [] : [
    { id: 'r1', fuel_station_id: 'sa', fuel_product_id: 'p1', price_per_liter_minor: 233, effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, status: 'active' },
    { id: 'r2', fuel_station_id: 'sa', fuel_product_id: 'p2', price_per_liter_minor: 218, effective_from: '2026-01-01T00:00:00+00:00', effective_until: null, status: 'active' },
  ];
  const shifts = scenario === 'no-shift' ? [] : [
    { id: 'h1', number: 'SH-1001', status: 'open', station_id: 'sa', opening_float_minor: 0, operational_liters: '5740', cash_variance_minor: null, opened_at: '2026-11-04T03:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null },
    { id: 'h2', number: 'SH-1000', status: 'closed', station_id: 'sa', opening_float_minor: 0, operational_liters: '6110.5', cash_variance_minor: 0, opened_at: '2026-11-03T11:00:00+00:00', closed_at: '2026-11-03T19:00:00+00:00', approved_at: null, cash_variance: null },
    { id: 'h3', number: 'SH-0999', status: 'approved', station_id: 'sa', opening_float_minor: 0, operational_liters: '5322', cash_variance_minor: 0, opened_at: '2026-11-03T03:00:00+00:00', closed_at: '2026-11-03T11:00:00+00:00', approved_at: '2026-11-03T20:00:00+00:00', cash_variance: null },
  ];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const station = url.searchParams.get('station_id');
    if (p === '/me') return json(route, { user, company: { name: n.company } });
    if (p === '/company') return json(route, { data: { name: n.company, logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p.startsWith('/fuel-stations')) {
      if (scenario === 'loading') return new Promise<void>(() => {});
      if (scenario === 'offline') return route.abort('internetdisconnected');
      if (scenario === 'server-error') return json(route, { message: 'x' }, 500);
      if (scenario === 'forbidden') return json(route, { message: 'x' }, 403);
    }
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/products') return json(route, { data: scenario === 'no-products' ? [] : products });
    if (p === '/fuel-stations/pumps') return json(route, { data: scenario === 'no-products' ? [] : pumps });
    if (p === '/fuel-stations/tanks') return json(route, { data: scenario === 'no-products' ? [] : tanks });
    if (p === '/fuel-stations/nozzles') return json(route, { data: scenario === 'no-products' ? [] : nozzles });
    if (p === '/fuel-stations/prices') { const prod = url.searchParams.get('fuel_product_id'); return json(route, { data: prices.filter((r) => (!prod || r.fuel_product_id === prod) && (!station || r.fuel_station_id === station)), meta: { current_page: 1, last_page: 1 } }); }
    if (p === '/fuel-stations/shifts') return json(route, { data: shifts.filter((s) => (!station || s.station_id === station) && (!url.searchParams.get('status') || s.status === url.searchParams.get('status'))), meta: { current_page: 1, last_page: 1 } });
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('station_use_erp', JSON.parse(u).id); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);
  await page.goto(`${baseUrl}/fuel-stations/ops${path}`, { waitUntil: 'domcontentloaded' });
  return issues;
}

async function settle(page: Page, scenario: Scenario = 'default') {
  await page.locator('#fo-main').waitFor({ state: 'attached' });
  if (scenario === 'loading') await page.waitForTimeout(800);
  else await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const shot = async (page: Page, rel: string, scale: number) => {
  const file = join(OUT!, `${rel}.png`);
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, scale: scale >= 2 ? 'device' : 'css' });
};

const findings: Array<Record<string, unknown>> = [];

test.describe('matrix: screens × viewports × theme × locale', () => {
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const vp of VIEWPORTS) for (const path of SCREENS) {
    test(`${screenName(path)} ${locale} ${theme} ${vp.w}x${vp.h}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const issues = await open(page, path, { locale, theme, viewport: vp });
      await settle(page);
      await shot(page, `matrix/${screenName(path)}-${locale}-${theme}-${vp.w}x${vp.h}`, vp.w === 390 ? 2 : 1);

      const m = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label]') as HTMLElement;
        const main = document.querySelector('#fo-main') as HTMLElement;
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const small: string[] = [];
        for (const el of document.querySelectorAll('nav a, header a, header select, main a, main button, main select')) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        const lastBottom = Math.max(...[...main.querySelectorAll('*')].map((e) => (e as HTMLElement).getBoundingClientRect().bottom));
        const navTop = nav.getBoundingClientRect().top;
        const field = document.querySelector('select');
        return { overflow, small, clearance: Math.round(navTop - lastBottom), navTop: Math.round(navTop), fieldFont: field ? parseFloat(getComputedStyle(field).fontSize) : null, devtools: !!document.querySelector('nextjs-portal, [data-nextjs-toast]'), dir: document.documentElement.dir, dark: document.documentElement.classList.contains('dark') };
      });
      findings.push({ id: `${screenName(path)}-${locale}-${theme}-${vp.w}`, ...m, issues });
      if (vp.w === 320 || vp.w === 390) await shot(page, `scrolled-bottom/${screenName(path)}-${locale}-${theme}-${vp.w}x${vp.h}`, 1);
      expect(m.overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
      expect(m.devtools).toBe(false);
      expect(m.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(m.dark).toBe(theme === 'dark');
      expect(m.clearance, 'content must clear the bottom navigation when scrolled to the end').toBeGreaterThanOrEqual(0);
      await context.close();
    });
  }
});

test.describe('states (390x844)', () => {
  const states: Array<[Scenario, string, string]> = [
    ['default', '', 'active-shift'], ['no-shift', '', 'no-shift'], ['no-products', '', 'empty-products'], ['no-price', '', 'missing-price'],
    ['forbidden', '', 'forbidden'], ['server-error', '', 'server-error'], ['offline', '', 'offline'], ['loading', '', 'loading'], ['no-perms', '', 'no-permission'],
    ['no-products', '/products', 'products-empty'], ['no-shift', '/shifts', 'shifts-empty'], ['forbidden', '/products', 'products-forbidden'],
  ];
  for (const locale of ['ar', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const [scenario, path, name] of states) {
    if (theme === 'dark' && !['active-shift', 'no-shift', 'forbidden', 'server-error'].includes(name)) continue;
    test(`${name} ${locale} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await open(page, path, { locale, theme, scenario, viewport: { w: 390, h: 844 } });
      await settle(page, scenario);
      await shot(page, `states/${name}-${locale}-${theme}`, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await context.close();
    });
  }
});

test('reference prototype captures (same viewports)', async ({ browser }) => {
  test.skip(!REFERENCE, 'VQA_REFERENCE_HTML not provided');
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.w === 390 ? 2 : 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`file://${REFERENCE}`);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, `reference/home-ar-light-${vp.w}x${vp.h}`, vp.w === 390 ? 2 : 1);
    for (const id of ['handover', 'meters', 'shifts']) {
      await page.evaluate((x) => (window as unknown as { go: (i: string) => void }).go(x), id);
      await page.waitForTimeout(150);
      if (vp.w === 390) await shot(page, `reference/${id}-ar-light-${vp.w}x${vp.h}`, 2);
    }
    await context.close();
  }
});

test.afterAll(() => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
});
