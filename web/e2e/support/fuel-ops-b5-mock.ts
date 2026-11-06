import type { Page, Route } from '@playwright/test';

/**
 * FUEL-B5 — خادم أَوْج الوهمي **بحالة** لمواصفة استلام الوقود. **بيانات اختبار فقط** (أسماء موسومة Fixture/تجريبية، لا مستأجر ولا محطة ولا مورد حقيقي)،
 * والاعتراض كامل: لا خلفية ولا كتابة لأي بيانات حقيقية. كل POST يُسجَّل؛ ويمكن حقن «رفض فصل المعتمِد» لمرة واحدة.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;
export interface Controls { distinctApprover: boolean }
export interface Post { path: string; body: Dict }

export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DRAFT_ID = UID(1);
export const APPROVED_ID = UID(2);

export const CREATOR = ['fuel_stations.view', 'fuel.shift.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record', 'products.view_cost'];
export const APPROVER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.delivery.view', 'fuel.delivery.approve'];
export const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'];

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'موظف تجريبي' : 'Fixture User',
    station: ar ? 'محطة تجريبية أ' : 'Fixture Station A',
    warehouse: ar ? 'مخزن تجريبي' : 'Fixture Warehouse',
    suppliers: ar ? ['مورد تجريبي ١', 'مورد تجريبي ٢'] : ['Fixture Supplier 1', 'Fixture Supplier 2'],
    product: ar ? 'وقود تجريبي' : 'Fixture Fuel',
    tanks: ar ? ['خزان تجريبي ١', 'خزان تجريبي ٢'] : ['Fixture Tank 1', 'Fixture Tank 2'],
  };
}

export async function mockB5Api(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[]; canSeeCost: boolean }) {
  const n = names(opts.locale);
  const user = { id: 'fx-viewer', name: n.user, email: 'fx@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const station = { id: 'sa', code: 'FX-A', name: n.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null, warehouse_id: 'wh1', warehouse: { id: 'wh1', name: n.warehouse, code: 'FXW' } };
  const products = [{ id: 'p1', code: 'FX1', name: n.product, is_active: true }];
  const tanks = n.tanks.map((name, i) => ({ id: `t${i + 1}`, fuel_station_id: 'sa', fuel_product_id: 'p1', code: `T${i + 1}`, name, capacity_milliliters: 30_000_000, minimum_level_milliliters: null, status: i === 1 ? 'inactive' : 'active' }));
  const suppliers = n.suppliers.map((name, i) => ({ id: `sup${i + 1}`, name, code: `FXS-${i + 1}` }));
  const readings: Dict[] = [
    { id: 'rd-b', fuel_tank_id: 't1', reading_type: 'physical', quantity_milliliters: 1_200_000, evidence_key: 'fx-b', measured_at: '2026-11-06T07:00:00+00:00' },
    { id: 'rd-a', fuel_tank_id: 't1', reading_type: 'physical', quantity_milliliters: 11_150_000, evidence_key: 'fx-a', measured_at: '2026-11-06T08:20:00+00:00' },
  ];
  const mk = (id: string, status: string, note: string, over: Dict = {}): Dict => ({
    id, status, station_id: 'sa', tank_id: 't1', fuel_product_id: 'p1', warehouse_id: 'wh1', supplier_id: 'sup1', purchase_reference: 'PO-FX-1', delivery_note_number: note,
    dispatched_milliliters: 10_000_000, received_milliliters: 9_950_000, transit_variance_milliliters: -50_000, received_total_cost_minor: 1_250_000, stock_movement_id: null,
    received_at: '2026-11-06T08:30:00+00:00', approved_at: null, approved_by: null, notes: null, created_at: '2026-11-06T08:30:00+00:00', created_by: 'fx-creator', tanker_identifier: 'FX-TNK-1', driver_name: null,
    supplier: { id: 'sup1', name: n.suppliers[0], code: 'FXS-1' }, tank: { id: 't1', name: n.tanks[0], code: 'T1' }, warehouse: { id: 'wh1', name: n.warehouse, code: 'FXW' },
    before_physical_reading_id: 'rd-b', after_physical_reading_id: 'rd-a', ...over,
  });
  const deliveries: Dict[] = [mk(DRAFT_ID, 'draft', 'DN-FX-101'), mk(APPROVED_ID, 'approved', 'DN-FX-100', { approved_by: 'fx-other', approved_at: '2026-11-06T09:00:00+00:00', stock_movement_id: 'mv-fx' })];

  const controls: Controls = { distinctApprover: false };
  const posts: Post[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  const issues: string[] = [];
  let seq = 10;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const lookup = (id?: string | null) => { const r = readings.find((x) => x.id === id); return r ? { id: r.id, quantity_milliliters: r.quantity_milliliters, quantity_liters: String(r.quantity_milliliters / 1000), measured_at: r.measured_at } : id ? { id } : null; };
  const view = (row: Dict): Dict => {
    const copy = JSON.parse(JSON.stringify(row));
    if (!opts.canSeeCost) delete copy.received_total_cost_minor;
    copy.readings = { before_physical: lookup(row.before_physical_reading_id), after_physical: lookup(row.after_physical_reading_id), before_atg: null, after_atg: null };
    return copy;
  };

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    requests.push({ method, path: p });
    if (p === '/me') return json(route, { user, company: { name: n.company } });
    if (p === '/company') return json(route, { data: { name: n.company, logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/fuel-stations/stations') return json(route, { data: [station] });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/fuel-stations/pumps' || p === '/fuel-stations/nozzles') return json(route, { data: [] });
    if (p === '/fuel-stations/shifts') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });

    if (method === 'POST' && p.startsWith('/fuel-stations/')) {
      const body = (request.postDataJSON() ?? {}) as Dict;
      posts.push({ path: p, body });
      if (p === '/fuel-stations/readings') {
        const r = { id: `rd-${++seq}`, fuel_tank_id: body.fuel_tank_id, reading_type: body.reading_type, quantity_milliliters: Math.round(Number(body.quantity_liters) * 1000), evidence_key: body.evidence_key, measured_at: '2026-11-06T08:00:00+00:00' };
        readings.push(r);
        return json(route, { data: r }, 201);
      }
      if (p === '/fuel-stations/deliveries') {
        const row = mk(UID(++seq), 'draft', body.delivery_note_number ?? null, {
          supplier_id: body.supplier_id, tank_id: body.fuel_tank_id, dispatched_milliliters: Math.round(Number(body.dispatched_liters) * 1000), received_milliliters: Math.round(Number(body.received_liters) * 1000),
          transit_variance_milliliters: Math.round((Number(body.received_liters) - Number(body.dispatched_liters)) * 1000), received_total_cost_minor: body.received_total_cost_minor, created_by: 'fx-viewer',
          before_physical_reading_id: body.before_physical_reading_id ?? null, after_physical_reading_id: body.after_physical_reading_id ?? null,
        });
        deliveries.unshift(row);
        return json(route, { data: view(row) }, 201);
      }
      const approve = /^\/fuel-stations\/deliveries\/([\w-]+)\/approve$/.exec(p);
      if (approve) {
        const row = deliveries.find((d) => d.id === approve[1]);
        if (!row) return json(route, { message: 'not found' }, 404);
        if (controls.distinctApprover) { controls.distinctApprover = false; return json(route, { message: 'FUEL_DISTINCT_APPROVER_REQUIRED: سياسة المحطة تتطلب أن يعتمد استلام الوقود مستخدمٌ غير الذي أنشأه.' }, 422); }
        row.status = 'approved'; row.approved_by = 'fx-viewer'; row.approved_at = '2026-11-06T10:00:00+00:00';
        return json(route, { data: view(row) });
      }
      issues.push(`unexpected POST ${p}`);
      return json(route, { message: 'not found' }, 404);
    }

    if (p === '/fuel-stations/deliveries') {
      const status = url.searchParams.get('status');
      const rows = deliveries.filter((d) => !status || d.status === status);
      return json(route, { data: rows.map(view), meta: { current_page: 1, last_page: 1 } });
    }
    const one = /^\/fuel-stations\/deliveries\/([\w-]+)$/.exec(p);
    if (one) { const row = deliveries.find((d) => d.id === one[1]); return row ? json(route, { data: view(row) }) : json(route, { message: 'not found' }, 404); }
    if (p === '/fuel-stations/delivery-suppliers') return json(route, { data: suppliers });
    if (p === '/fuel-stations/readings') return json(route, { data: readings });
    if (method !== 'GET') issues.push(`unexpected ${method} ${p}`);
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);

  return { controls, posts, requests, issues, deliveries, names: n };
}
