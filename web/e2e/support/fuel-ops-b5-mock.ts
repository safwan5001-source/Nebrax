import type { Page, Route } from '@playwright/test';

/**
 * FUEL-B5/B5.1 — خادم أَوْج الوهمي **بحالة** لمواصفة استلام الوقود (التكلفة المنفصلة، المرفقات، السند والتصدير). **بيانات اختبار فقط** (أسماء موسومة Fixture/تجريبية، لا مستأجر ولا محطة ولا مورد حقيقي)،
 * والاعتراض كامل: لا خلفية ولا كتابة لأي بيانات حقيقية. كل POST يُسجَّل؛ ويمكن حقن «رفض فصل المعتمِد» لمرة واحدة.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;
export interface Controls { distinctApprover: boolean }
export interface Post { path: string; method: string; body: Dict }

export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DRAFT_ID = UID(1);
export const APPROVED_ID = UID(2);
/** مسودة تكلفتها مسجَّلة (جاهزة للاعتماد). */
export const COSTED_ID = UID(3);

/** موظف محطة: ينشئ ويرفق ويقرأ، بلا أي صلاحية تكلفة. */
export const CREATOR = ['fuel_stations.view', 'fuel.shift.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record'];
/** المالية: ترى التكلفة وتسجّلها فقط. */
export const FINANCE = ['fuel_stations.view', 'fuel.shift.view', 'fuel.delivery.view', 'fuel.delivery.cost.record', 'products.view_cost'];
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
    dispatched_milliliters: 10_000_000, received_milliliters: 9_950_000, transit_variance_milliliters: -50_000, received_total_cost_minor: 1_250_000, cost_recorded_by: 'fx-finance', cost_recorded_at: '2026-11-06T08:45:00+00:00', stock_movement_id: null,
    received_at: '2026-11-06T08:30:00+00:00', approved_at: null, approved_by: null, notes: null, created_at: '2026-11-06T08:30:00+00:00', created_by: 'fx-creator', tanker_identifier: 'FX-TNK-1', driver_name: null,
    supplier: { id: 'sup1', name: n.suppliers[0], code: 'FXS-1' }, tank: { id: 't1', name: n.tanks[0], code: 'T1' }, warehouse: { id: 'wh1', name: n.warehouse, code: 'FXW' },
    before_physical_reading_id: 'rd-b', after_physical_reading_id: 'rd-a', ...over,
  });
  const deliveries: Dict[] = [
    mk(DRAFT_ID, 'draft', 'DN-FX-101', { received_total_cost_minor: null, cost_recorded_by: null, cost_recorded_at: null }),
    mk(COSTED_ID, 'draft', 'DN-FX-102'),
    mk(APPROVED_ID, 'approved', 'DN-FX-100', { approved_by: 'fx-other', approved_at: '2026-11-06T09:00:00+00:00', stock_movement_id: 'mv-fx' }),
  ];
  const attachments: Record<string, Dict[]> = { [COSTED_ID]: [{ id: '00000000-0000-4000-9000-000000000001', name: 'delivery-note.png', mime_type: 'image/png', size: 84_213, uploaded_by: 'fx-creator', created_at: '2026-11-06T08:40:00+00:00' }] };

  const controls: Controls = { distinctApprover: false };
  const posts: Post[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  const issues: string[] = [];
  let seq = 10;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const lookup = (id?: string | null) => { const r = readings.find((x) => x.id === id); return r ? { id: r.id, quantity_milliliters: r.quantity_milliliters, quantity_liters: String(r.quantity_milliliters / 1000), measured_at: r.measured_at } : id ? { id } : null; };
  const view = (row: Dict): Dict => {
    const copy = JSON.parse(JSON.stringify(row));
    copy.cost_recorded = row.received_total_cost_minor !== null && row.received_total_cost_minor !== undefined;
    if (!opts.canSeeCost) { delete copy.received_total_cost_minor; delete copy.cost_recorded_by; delete copy.cost_recorded_at; }
    copy.attachments = attachments[row.id] ?? [];
    copy.attachments_count = copy.attachments.length;
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

    if ((method === 'POST' || method === 'DELETE') && p.startsWith('/fuel-stations/')) {
      const multipart = (request.headers()['content-type'] ?? '').startsWith('multipart/form-data');
      const body = (multipart ? { files: [...(request.postData() ?? '').matchAll(/filename="([^"]+)"/g)].map((m) => m[1]) } : (method === 'DELETE' ? {} : (request.postDataJSON() ?? {}))) as Dict;
      posts.push({ path: p, method, body });
      if (p === '/fuel-stations/readings') {
        const r = { id: `rd-${++seq}`, fuel_tank_id: body.fuel_tank_id, reading_type: body.reading_type, quantity_milliliters: Math.round(Number(body.quantity_liters) * 1000), evidence_key: body.evidence_key, measured_at: '2026-11-06T08:00:00+00:00' };
        readings.push(r);
        return json(route, { data: r }, 201);
      }
      if (p === '/fuel-stations/deliveries') {
        const row = mk(UID(++seq), 'draft', body.delivery_note_number ?? null, {
          supplier_id: body.supplier_id, tank_id: body.fuel_tank_id, dispatched_milliliters: Math.round(Number(body.dispatched_liters) * 1000), received_milliliters: Math.round(Number(body.received_liters) * 1000),
          transit_variance_milliliters: Math.round((Number(body.received_liters) - Number(body.dispatched_liters)) * 1000), received_total_cost_minor: null, cost_recorded_by: null, cost_recorded_at: null, created_by: 'fx-viewer',
          before_physical_reading_id: body.before_physical_reading_id ?? null, after_physical_reading_id: body.after_physical_reading_id ?? null,
        });
        deliveries.unshift(row);
        return json(route, { data: view(row) }, 201);
      }
      const approve = /^\/fuel-stations\/deliveries\/([\w-]+)\/approve$/.exec(p);
      if (approve) {
        const row = deliveries.find((d) => d.id === approve[1]);
        if (!row) return json(route, { message: 'not found' }, 404);
        if (row.received_total_cost_minor === null || row.received_total_cost_minor === undefined) return json(route, { message: 'FUEL_DELIVERY_COST_REQUIRED: لا يمكن اعتماد استلام قبل تسجيل تكلفته الفعلية.' }, 422);
        if (controls.distinctApprover) { controls.distinctApprover = false; return json(route, { message: 'FUEL_DISTINCT_APPROVER_REQUIRED: سياسة المحطة تتطلب أن يعتمد استلام الوقود مستخدمٌ غير الذي أنشأه.' }, 422); }
        row.status = 'approved'; row.approved_by = 'fx-viewer'; row.approved_at = '2026-11-06T10:00:00+00:00';
        return json(route, { data: view(row) });
      }
      const cost = /^\/fuel-stations\/deliveries\/([\w-]+)\/cost$/.exec(p);
      if (cost) {
        const row = deliveries.find((d) => d.id === cost[1]);
        if (!row) return json(route, { message: 'not found' }, 404);
        row.received_total_cost_minor = body.received_total_cost_minor; row.cost_recorded_by = 'fx-viewer'; row.cost_recorded_at = '2026-11-06T11:00:00+00:00';
        return json(route, { data: view(row) });
      }
      const upload = /^\/fuel-stations\/deliveries\/([\w-]+)\/attachments$/.exec(p);
      if (upload && method === 'POST') {
        const list = (attachments[upload[1]] ??= []);
        const made = (body.files as string[]).map((name) => { const a = { id: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, name, mime_type: name.endsWith('.pdf') ? 'application/pdf' : 'image/png', size: 52_000, uploaded_by: 'fx-viewer', created_at: '2026-11-06T11:05:00+00:00' }; list.push(a); return a; });
        return json(route, { data: made }, 201);
      }
      const removal = /^\/fuel-stations\/deliveries\/([\w-]+)\/attachments\/([\w-]+)$/.exec(p);
      if (removal && method === 'DELETE') { attachments[removal[1]] = (attachments[removal[1]] ?? []).filter((a) => a.id !== removal[2]); return route.fulfill({ status: 204 }); }
      issues.push(`unexpected ${method} ${p}`);
      return json(route, { message: 'not found' }, 404);
    }

    const variant = url.searchParams.get('variant') ?? 'operational';
    const deny = variant === 'financial' && !opts.canSeeCost;
    const liters = (ml: number) => String(ml / 1000);
    const doc = (row: Dict): Dict => ({
      variant, generated_at: '2026-11-06T10:00:00+00:00', generated_by: n.user, company: { name: n.company, vat_number: '300000000000003', cr_number: '1010101010', currency: 'SAR' },
      station: { code: 'FX-A', name: n.station, city: null, address: null }, reference: `FD-${row.id.slice(0, 8).toUpperCase()}`, status: row.status, delivery_note_number: row.delivery_note_number, purchase_reference: row.purchase_reference,
      supplier: { name: n.suppliers[0], code: 'FXS-1' }, product: { code: 'FX1', name: n.product }, tank: { code: 'T1', name: n.tanks[0] }, warehouse: { code: 'FXW', name: n.warehouse },
      tanker_identifier: row.tanker_identifier, driver_name: null, quantities: { dispatched_liters: liters(row.dispatched_milliliters), received_liters: liters(row.received_milliliters), transit_variance_liters: liters(row.transit_variance_milliliters), transit_variance_percent: '-0.50' },
      readings: { before_physical: { liters: '1200', measured_at: null }, after_physical: { liters: '11150', measured_at: null }, before_atg: null, after_atg: null }, received_at: row.received_at, received_by: n.user, approved_by: row.approved_by ? n.user : null, approved_at: row.approved_at,
      notes: null, attachments: (attachments[row.id] ?? []).map((a) => ({ name: a.name, mime_type: a.mime_type, size: a.size })),
      ...(variant === 'financial' ? { cost: { currency: 'SAR', total_minor: row.received_total_cost_minor ?? null, per_liter: '1.2563', recorded_by: n.user, recorded_at: null } } : {}),
    });
    if (p === '/fuel-stations/deliveries/report') {
      if (deny) return json(route, { message: 'forbidden' }, 403);
      return json(route, { data: { variant, generated_at: '2026-11-06T10:00:00+00:00', generated_by: n.user, company: { name: n.company, vat_number: null, cr_number: null, currency: 'SAR' }, filters: [], truncated: false,
        rows: deliveries.map((d) => ({ reference: `FD-${d.id.slice(0, 8).toUpperCase()}`, received_at: d.received_at, status: d.status, delivery_note_number: d.delivery_note_number, station: n.station, supplier: n.suppliers[0], product: n.product, tank: 'T1', dispatched_liters: liters(d.dispatched_milliliters), received_liters: liters(d.received_milliliters), transit_variance_liters: liters(d.transit_variance_milliliters), ...(variant === 'financial' ? { total_cost_minor: d.received_total_cost_minor } : {}) })),
        totals: { count: deliveries.length, dispatched_liters: '30000', received_liters: '29850', transit_variance_liters: '-150', ...(variant === 'financial' ? { total_cost_minor: 3_750_000, uncosted_count: 1 } : {}) } } });
    }
    const docRoute = /^\/fuel-stations\/deliveries\/([\w-]+)\/document$/.exec(p);
    if (docRoute) { const row = deliveries.find((d) => d.id === docRoute[1]); if (!row) return json(route, { message: 'not found' }, 404); return deny ? json(route, { message: 'forbidden' }, 403) : json(route, { data: doc(row) }); }
    if (/\/attachments\/[\w-]+\/download$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    if (/\/export$/.test(p) || p === '/fuel-stations/deliveries/export') return deny ? json(route, { message: 'forbidden' }, 403) : route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': 'attachment; filename="fuel-receipt.xlsx"' }, body: Buffer.from('PK') });

    if (p === '/fuel-stations/deliveries') {
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const costFilter = url.searchParams.get('cost');
      const rows = deliveries.filter((d) => (!status || d.status === status) && (q === '' || String(d.delivery_note_number).toLowerCase().includes(q)) && (!costFilter || ((d.received_total_cost_minor === null) === (costFilter === 'missing'))));
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

  return { controls, posts, requests, issues, deliveries, attachments, names: n };
}
