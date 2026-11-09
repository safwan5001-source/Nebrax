import type { Page, Route } from '@playwright/test';

/**
 * AWJ-DOC-V2-PR7 — خادم أَوْج وهمي **بحالة** لمواصفة تقرير إغلاق الوردية. **بيانات اختبار فقط** (أسماء موسومة Fixture، لا مستأجر/محطة حقيقية)،
 * والاعتراض كامل (لا خلفية ولا كتابة حقيقية). كل POST يُسجَّل؛ الإغلاق يقلب حالة الوردية فتظهر اللقطة المجمَّدة بعده فقط (كما يفعل الخادم).
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;
export interface Post { path: string; body: Dict }

export const CLOSE_PERMS = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];
export const SALES_PERMS = [...CLOSE_PERMS, 'fuel.sale.view'];

const ml = (liters: number) => Math.round(liters * 1000);

export async function mockPr7Api(page: Page, opts: { baseUrl: string; locale: Locale; theme?: 'light' | 'dark'; permissions: string[]; status: 'open' | 'closed' | 'approved'; collection: 'frozen' | 'hidden' | 'none' | 'error' }) {
  const ar = opts.locale === 'ar';
  const names = { company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.', user: ar ? 'موظف تجريبي' : 'Fixture User', station: ar ? 'محطة تجريبية أ' : 'Fixture Station A', products: ar ? ['وقود تجريبي أ', 'وقود تجريبي ب'] : ['Fixture Fuel 1', 'Fixture Fuel 2'] };
  const user = { id: 'fx-viewer', name: names.user, email: 'fx@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const station = { id: 'sa', code: 'FX-A', name: names.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null };
  const products = names.products.map((name, i) => ({ id: `p${i + 1}`, code: `FX${i + 1}`, name, is_active: true }));
  const pumps = [1, 2, 3].map((n) => ({ id: `pump${n}`, fuel_station_id: 'sa', pump_number: String(n), name: null, status: 'active' }));
  const tanks = products.map((p, i) => ({ id: `t${i + 1}`, fuel_station_id: 'sa', fuel_product_id: p.id, code: `T${i + 1}`, name: `Fixture Tank ${i + 1}`, capacity_milliliters: 30_000_000, minimum_level_milliliters: null, status: 'active' }));
  // ثلاث مضخات × فوهتان = ست فوهات بمنتجين.
  const nozzles = pumps.flatMap((p, i) => [0, 1].map((k) => ({ id: `n${i * 2 + k + 1}`, fuel_station_id: 'sa', fuel_pump_id: p.id, fuel_tank_id: tanks[k].id, fuel_product_id: products[k].id, nozzle_number: String(k + 1), status: 'active' })));
  // قراءات دقيقة: فتح 1,234,567.891 لتر وإغلاق بعد 1,234.567 لتر فرقاً لكل فوهة (لا تقريب).
  const meterReadings = nozzles.flatMap((n, i) => [
    { id: `mo${i}`, nozzle_id: n.id, reading_stage: 'opening', meter_milliliters: ml(1_234_567.891) + i * 1000, measured_at: '2026-11-03T05:05:00+00:00' },
    { id: `mc${i}`, nozzle_id: n.id, reading_stage: 'closing', meter_milliliters: ml(1_234_567.891) + i * 1000 + ml(1_234.567), measured_at: '2026-11-03T12:58:00+00:00' },
  ]);
  const perNozzle = ml(1_234.567);
  const totalMl = perNozzle * 6;
  const p1Ml = perNozzle * 3;
  const p2Ml = perNozzle * 3;
  const state = { status: opts.status as string };
  const posts: Post[] = [];
  const requests: Array<{ method: string; path: string }> = [];

  const detail = (): Dict => ({
    id: 's1', number: 'FX-SH-0100', status: state.status, station_id: 'sa', branch_id: null, opening_float_minor: 20_000,
    operational_liters: state.status === 'open' ? '0' : String(totalMl / 1000), operational_meter_milliliters: state.status === 'open' ? 0 : totalMl,
    cash_variance_minor: state.status === 'open' ? null : 0, counted_cash_minor: state.status === 'open' ? null : 25_000, expected_operational_cash_minor: state.status === 'open' ? null : 25_000,
    opened_at: '2026-11-03T05:00:00+00:00', closed_at: state.status === 'open' ? null : '2026-11-03T13:00:00+00:00', approved_at: state.status === 'approved' ? '2026-11-03T14:00:00+00:00' : null, locked_at: null,
    closed_by: state.status === 'open' ? null : 'fx-viewer', opened_by: 'fx-viewer', approved_by: null,
    meter_readings: meterReadings,
    tank_readings: tanks.flatMap((t, i) => [
      { id: `to${i}`, tank_id: t.id, reading_stage: 'opening', reading_type: 'physical', quantity_milliliters: 9_000_000, measured_at: '2026-11-03T05:10:00+00:00' },
      { id: `tc${i}`, tank_id: t.id, reading_stage: 'closing', reading_type: 'physical', quantity_milliliters: 8_000_000, measured_at: '2026-11-03T12:55:00+00:00' },
    ]),
    staff_assignments: [{ user_id: 'fx-viewer' }], cash_movements: [], cash_variance: null, events: [],
  });

  const price = [200, 250];
  const collection = (): Dict | 'none' => {
    const frozen = state.status !== 'open';
    const salesVisible = opts.collection !== 'hidden';
    const amounts = [Math.round((p1Ml * price[0]) / 1000), Math.round((p2Ml * price[1]) / 1000)];
    const sales = amounts[0] + amounts[1];
    return {
      enabled: true, state: frozen ? 'frozen' : 'none', revision: frozen ? 2 : 0,
      methods: [{ id: 'm-cash', name: names.user.startsWith('م') ? 'نقد' : 'Cash', name_en: null, settlement_type: 'cash', saved_amount_minor: null }, { id: 'm-card', name: ar ? 'شبكة' : 'Card', name_en: null, settlement_type: 'bank', saved_amount_minor: null }],
      methods_changed: false, close_readiness: { ready: false, blockers: ['required'], reason_required: false },
      review: salesVisible ? { visible: true, state: 'not_required', reason: null, note: null, reviewed_by: null, reviewed_at: null } : { visible: false },
      declaration: frozen ? {
        id: 'd1', revision: 2, status: 'frozen',
        lines: [{ payment_method_id: 'm-cash', name: ar ? 'نقد' : 'Cash', settlement_type: 'cash', amount_minor: sales - 12_345, still_allowed: true }, { payment_method_id: 'm-card', name: ar ? 'شبكة' : 'Card', settlement_type: 'bank', amount_minor: 12_345, still_allowed: true }],
        collected_total_minor: sales, cash_declared_minor: sales - 12_345, network_declared_minor: 12_345,
      } : null,
      sales: {
        visible: salesVisible, complete: true, milliliters: totalMl, milliliters_complete: true, amount_minor: salesVisible ? sales : null, tax_mode: 'tax_inclusive', evaluated_at: '2026-11-03T13:00:00+00:00',
        products: products.map((p, i) => ({ fuel_product_id: p.id, name: p.name, nozzle_count: 3, milliliters: i === 0 ? p1Ml : p2Ml, gaps: [], ...(salesVisible ? { price_per_liter_minor: price[i], price_source: 'station_override', amount_minor: amounts[i] } : {}) })),
        nozzles: [], gaps: [],
      },
      reconciliation: salesVisible ? { visible: true, final: true, reason: null, collected_total_minor: sales, sales_minor: sales, difference_minor: 0, direction: 'none' } : { visible: false },
      drawer: { frozen, opening_float_minor: 20_000, counted_cash_minor: frozen ? 25_000 : null, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: salesVisible, amount_minor: null, declared_difference_minor: null } },
      disclaimers: ['operational_not_financial_proof'],
    };
  };

  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('station_use_erp', JSON.parse(u).id); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    requests.push({ method, path: p });
    if (p === '/me') return json(route, { user, company: { name: names.company, vat_number: '300000000000003', cr_number: '1010101010', logo: null } });
    if (p === '/company') return json(route, { data: { name: names.company, vat_number: '300000000000003', cr_number: '1010101010', logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/fuel-stations/stations') return json(route, { data: [station] });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/pumps') return json(route, { data: pumps });
    if (p === '/fuel-stations/nozzles') return json(route, { data: nozzles });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/fuel-stations/prices/effective') return json(route, { data: [] });
    if (p === '/fuel-stations/stations/sa/settings') return json(route, { data: { shift_closing_meter_reading_required: true, shift_closing_tank_reading_required: true, shift_opening_meter_reading_required: true, shift_opening_tank_reading_required: true, shift_allow_close_with_pending_cash_variance: true } });
    if (p === '/fuel-stations/shifts' && method === 'GET') return json(route, { data: [{ ...detail(), meter_readings: undefined, tank_readings: undefined }], meta: { current_page: 1, last_page: 1 } });
    if (p === '/fuel-stations/shifts/s1' && method === 'GET') return json(route, { data: detail() });
    if (p === '/fuel-stations/shifts/s1/collection' && method === 'GET') {
      if (opts.collection === 'none' || (opts.collection === 'error')) return json(route, { message: 'x' }, opts.collection === 'error' ? 500 : 404);
      // قبل الإغلاق لا إقرار هنا (بوابة مغلقة) كي لا يعترض عرض الإغلاق الأصلي؛ بعده اللقطة المجمَّدة.
      return state.status === 'open' ? json(route, { message: 'not found' }, 404) : json(route, { data: collection() });
    }
    if (method === 'POST' && p.startsWith('/fuel-stations/')) {
      const body = (request.postDataJSON() ?? {}) as Dict;
      posts.push({ path: p, body });
      if (p === '/fuel-stations/shifts/s1/close') { state.status = 'closed'; return json(route, { data: detail() }); }
      return json(route, { message: 'unexpected write' }, 404);
    }
    return json(route, { message: 'not found' }, 404);
  });
  return { posts, requests, state };
}

export const EXPECTED = { perNozzle: '1,234.567', total: '7,407.402', productLiters: '3,703.701' };
