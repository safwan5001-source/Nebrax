import type { Page, Route } from '@playwright/test';

/**
 * FUEL-OPS UI-1 — خادم أَوْج الوهمي لمواصفات المتصفح (تفاصيل الوردية وقراءات العدادات).
 * **بيانات اختبار فقط**: كل الأسماء موسومة (Fixture/تجريبية) ولا تمثل أي مستأجر أو محطة حقيقية. الاعتراض كامل: لا خلفية، ولا كتابة
 * إلى أي بيانات. أي طلب غير GET يُسجَّل في `requests` ليفشل الاختبار الذي يتحقق من القراءة فقط.
 */
export type Locale = 'ar' | 'en';
export type Scenario =
  | 'default' | 'loading' | 'forbidden' | 'server-error' | 'offline' | 'not-found' | 'no-permission'
  | 'no-readings' | 'anomalies' | 'refresh-fails' | 'no-timezone';

export interface Controls { failDetail: boolean }

const ml = (liters: number) => Math.round(liters * 1000);

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'مستخدم تجريبي' : 'Fixture User',
    stations: [ar ? 'محطة تجريبية أ' : 'Fixture Station A', ar ? 'محطة تجريبية ب' : 'Fixture Station B'],
    products: ar ? ['وقود تجريبي 1', 'وقود تجريبي 2', 'وقود تجريبي 3'] : ['Fixture Fuel 1', 'Fixture Fuel 2', 'Fixture Fuel 3'],
  };
}

/** ست فوهات على ثلاث مضخات؛ لكل منتج فوهتان. القراءات أرقام عدّاد مطلقة بثلاث منازل عشرية. */
function build(locale: Locale, scenario: Scenario) {
  const n = names(locale);
  const stations = [
    { id: 'sa', code: 'FX-A', name: n.stations[0], status: 'active', branch_id: null, city: null, region: null, timezone: scenario === 'no-timezone' ? null : 'Asia/Riyadh', license_number: null, license_expires_at: null },
    { id: 'sb', code: 'FX-B', name: n.stations[1], status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null },
  ];
  const products = n.products.map((name, i) => ({ id: `p${i + 1}`, code: `FX${i + 1}`, name, is_active: true }));
  const pumps = [1, 2, 3].map((i) => ({ id: `u${i}`, fuel_station_id: 'sa', pump_number: String(i), name: null, status: 'active' }));
  const tanks = products.map((p, i) => ({ id: `t${i + 1}`, fuel_station_id: 'sa', fuel_product_id: p.id, code: `T${i + 1}`, name: locale === 'ar' ? `خزان ${i + 1}` : `Tank ${i + 1}`, capacity_milliliters: ml(30_000 - i * 5_000), minimum_level_milliliters: null, status: 'active' }));
  const nozzles = products.flatMap((p, i) => [1, 2].map((k) => ({ id: `n${i}${k}`, fuel_station_id: 'sa', fuel_pump_id: `u${i + 1}`, fuel_tank_id: `t${i + 1}`, fuel_product_id: p.id, nozzle_number: String(k), status: 'active' })));
  const nozzleIds = nozzles.map((z) => z.id);

  const opening = (i: number) => ml(125_430 + i * 13_700) + i * 250;
  const delta = (i: number) => ml(640 + i * 37) + 500;
  const reading = (id: string, nozzle: string, stage: 'opening' | 'closing', value: number, at: string) => ({ id, nozzle_id: nozzle, reading_stage: stage, meter_milliliters: value, measured_at: at });
  const tankReading = (id: string, tank: string, stage: 'opening' | 'closing', value: number, type: string, at: string) => ({ id, tank_id: tank, reading_stage: stage, reading_type: type, quantity_milliliters: value, measured_at: at });

  const closedReadings = (prefix: string, openAt: string, closeAt: string) => nozzleIds.flatMap((z, i) => [reading(`${prefix}o${i}`, z, 'opening', opening(i), openAt), reading(`${prefix}c${i}`, z, 'closing', opening(i) + delta(i), closeAt)]);
  const totalMl = nozzleIds.reduce((sum, _z, i) => sum + delta(i), 0);

  const base = {
    branch_id: null, opening_float_minor: 50_000, counted_cash_minor: null, expected_operational_cash_minor: null, cash_variance_minor: null,
    operational_meter_milliliters: 0, operational_liters: '0', locked_at: null, staff_assignments: [{ user_id: 'fx-user' }, { user_id: 'fx-2' }], cash_variance: null,
    tank_readings: [] as unknown[], meter_readings: [] as unknown[], station_id: 'sa',
  };

  // مفتوحة: كل الافتتاحيات + ثلاث إغلاقات فقط (جزئية). الخادم يُبقي الإجمالي 0 قبل الإغلاق.
  const openAt = '2026-11-04T03:05:00+00:00';
  const partial = [
    ...nozzleIds.map((z, i) => reading(`ho${i}`, z, 'opening', opening(i), openAt)),
    ...nozzleIds.slice(0, 3).map((z, i) => reading(`hc${i}`, z, 'closing', opening(i) + delta(i), '2026-11-04T09:40:00+00:00')),
  ];
  const h1 = {
    ...base, id: 'h1', number: 'SH-1001', status: 'open', opened_at: '2026-11-04T03:00:00+00:00', closed_at: null, approved_at: null,
    meter_readings: scenario === 'no-readings' ? [] : partial,
    tank_readings: scenario === 'no-readings' ? [] : [tankReading('hto1', 't1', 'opening', ml(21_480.5), 'physical', openAt), tankReading('hto2', 't2', 'opening', ml(15_200), 'atg', openAt)],
  };
  const h2 = {
    ...base, id: 'h2', number: 'SH-1000', status: 'closed', opened_at: '2026-11-03T03:00:00+00:00', closed_at: '2026-11-03T11:10:00+00:00', approved_at: null,
    operational_meter_milliliters: scenario === 'anomalies' ? totalMl + ml(12.5) : totalMl, operational_liters: String(totalMl / 1000),
    counted_cash_minor: 1_284_000, expected_operational_cash_minor: 1_285_500, cash_variance_minor: -1_500, cash_variance: { status: 'pending_review', variance_direction: 'shortage' },
    meter_readings: scenario === 'anomalies'
      ? closedReadings('x', '2026-11-03T03:06:00+00:00', '2026-11-03T11:05:00+00:00').map((r, i) => (i === 3 ? { ...r, meter_milliliters: 1_000 } : r))
      : closedReadings('x', '2026-11-03T03:06:00+00:00', '2026-11-03T11:05:00+00:00'),
    tank_readings: [tankReading('x1', 't1', 'opening', ml(24_000), 'physical', '2026-11-03T03:10:00+00:00'), tankReading('x2', 't1', 'closing', ml(21_310.25), 'physical', '2026-11-03T11:08:00+00:00')],
  };
  const h3 = {
    ...base, id: 'h3', number: 'SH-0999', status: 'approved', opened_at: '2026-11-02T20:00:00+00:00', closed_at: '2026-11-03T03:00:00+00:00', approved_at: '2026-11-03T05:30:00+00:00', locked_at: '2026-11-03T05:30:00+00:00',
    operational_meter_milliliters: totalMl, operational_liters: String(totalMl / 1000),
    counted_cash_minor: 990_000, expected_operational_cash_minor: 990_000, cash_variance_minor: 0, cash_variance: { status: 'not_required', variance_direction: 'none' },
    meter_readings: closedReadings('y', '2026-11-02T20:04:00+00:00', '2026-11-03T02:58:00+00:00'),
  };
  const details: Record<string, Record<string, unknown>> = { h1, h2, h3 };
  const strip = ({ id, number, status, station_id, opening_float_minor, operational_liters, cash_variance_minor, opened_at, closed_at, approved_at, cash_variance }: Record<string, unknown>) =>
    ({ id, number, status, station_id, opening_float_minor, operational_liters, cash_variance_minor, opened_at, closed_at, approved_at, cash_variance });
  return { n, stations, products, pumps, tanks, nozzles, shifts: [strip(h1), strip(h2), strip(h3)], details };
}

export async function mockOpsApi(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; scenario?: Scenario; permissions?: string[] }) {
  const scenario = opts.scenario ?? 'default';
  const d = build(opts.locale, scenario);
  const controls: Controls = { failDetail: false };
  const requests: Array<{ method: string; path: string; branch?: string }> = [];
  const issues: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/INVALID_KEY|Namespace keys|Failed to load resource/.test(m.text())) issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));

  const perms = scenario === 'no-permission' ? ['invoices.view'] : opts.permissions ?? ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view', 'fuel.shift.open', 'fuel.shift.approve'];
  const user = { id: 'fx-user', name: d.n.user, email: 'fixture@example.test', tenant_id: 'fx-tenant', role: 'cashier', branch_ids: [], warehouse_ids: [], permissions: perms };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push({ method: route.request().method(), path: p, branch: route.request().headers()['x-branch-id'] });
    const station = url.searchParams.get('station_id');
    if (p === '/me') return json(route, { user, company: { name: d.n.company } });
    if (p === '/company') return json(route, { data: { name: d.n.company, logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p.startsWith('/fuel-stations')) {
      const isDetail = /^\/fuel-stations\/shifts\/[\w-]+$/.test(p);
      if (scenario === 'loading') return new Promise<void>(() => {});
      if (scenario === 'offline') return route.abort('internetdisconnected');
      if (scenario === 'server-error') return json(route, { message: 'x' }, 500);
      if (scenario === 'forbidden') return json(route, { message: 'x' }, 403);
      if (isDetail && scenario === 'not-found') return json(route, { message: 'x' }, 404);
      if (isDetail && controls.failDetail) return route.abort('internetdisconnected');
    }
    if (p === '/fuel-stations/stations') return json(route, { data: d.stations });
    if (p === '/fuel-stations/products') return json(route, { data: d.products });
    if (p === '/fuel-stations/pumps') return json(route, { data: d.pumps });
    if (p === '/fuel-stations/tanks') return json(route, { data: d.tanks });
    if (p === '/fuel-stations/nozzles') return json(route, { data: d.nozzles });
    if (p === '/fuel-stations/prices') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });
    if (p === '/fuel-stations/shifts') {
      return json(route, { data: d.shifts.filter((s) => (!station || s.station_id === station) && (!url.searchParams.get('status') || s.status === url.searchParams.get('status'))), meta: { current_page: 1, last_page: 1 } });
    }
    const detail = /^\/fuel-stations\/shifts\/([\w-]+)$/.exec(p);
    if (detail) return d.details[detail[1]] ? json(route, { data: d.details[detail[1]] }) : json(route, { message: 'not found' }, 404);
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('station_use_erp', '1'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);
  return { requests, issues, controls, data: d };
}
