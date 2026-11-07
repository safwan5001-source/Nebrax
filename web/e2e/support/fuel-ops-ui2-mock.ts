import type { Page, Route } from '@playwright/test';

/**
 * FUEL-OPS UI-2 — خادم أَوْج الوهمي **بحالة** لمواصفات المتصفح (فتح وردية، إدخال القراءات، النقد والتسليم).
 * **بيانات اختبار فقط**: كل الأسماء موسومة (Fixture/تجريبية) ولا تمثل أي مستأجر أو محطة حقيقية، والاعتراض كامل: لا خلفية ولا كتابة إلى أي بيانات حقيقية.
 * يحاكي قواعد `FuelShiftService` المثبتة في `FuelShiftSellerContractTest` (سجل واحد لكل فوهة/مرحلة، idempotency بالمفتاح، الإغلاق يتحقق من التغطية
 * وclosing ≥ opening، متوقع النقد = عهدة + إيداعات − سحوبات − مصروفات). كل POST يُسجَّل في `posts`؛ ويمكن حقن أعطال لمرة واحدة عبر `controls.fault`.
 */
export type Locale = 'ar' | 'en';
export type Seed = 'none' | 'open-fresh' | 'open-opened' | 'ready';
export type FaultMode = 'lost_reply' | 'reject' | 'server_error' | 'forbidden';
export interface Fault { match: RegExp; mode: FaultMode; message?: string; times: number }
export interface Controls { fault: Fault | null }
export interface Post { path: string; body: Record<string, unknown>; branch?: string }

const ml = (liters: number) => Math.round(liters * 1000);
const USER_ID = 'fx-user';

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'مستخدم تجريبي' : 'Fixture User',
    station: ar ? 'محطة تجريبية أ' : 'Fixture Station A',
    products: ar ? ['وقود تجريبي 1', 'وقود تجريبي 2', 'وقود تجريبي 3'] : ['Fixture Fuel 1', 'Fixture Fuel 2', 'Fixture Fuel 3'],
  };
}

type Dict = Record<string, any>;

export const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];

export async function mockUi2Api(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; seed?: Seed; permissions?: string[]; policy?: Record<string, boolean> }) {
  const n = names(opts.locale);
  const policy = { shift_opening_meter_reading_required: true, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: true, shift_closing_tank_reading_required: true, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false, shift_allow_close_with_pending_cash_variance: true, ...opts.policy };

  const station = { id: 'sa', code: 'FX-A', name: n.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null };
  const products = n.products.map((name, i) => ({ id: `p${i + 1}`, code: `FX${i + 1}`, name, is_active: true }));
  const pumps = [1, 2, 3].map((i) => ({ id: `u${i}`, fuel_station_id: 'sa', pump_number: String(i), name: null, status: 'active' }));
  const tanks = products.map((p, i) => ({ id: `t${i + 1}`, fuel_station_id: 'sa', fuel_product_id: p.id, code: `T${i + 1}`, name: opts.locale === 'ar' ? `خزان ${i + 1}` : `Tank ${i + 1}`, capacity_milliliters: ml(30_000), minimum_level_milliliters: null, status: 'active' }));
  const nozzles = products.flatMap((p, i) => [1, 2].map((k) => ({ id: `n${i}${k}`, fuel_station_id: 'sa', fuel_pump_id: `u${i + 1}`, fuel_tank_id: `t${i + 1}`, fuel_product_id: p.id, nozzle_number: String(k), status: 'active' })));

  const detailBase = (id: string, number: string, status: string): Dict => ({
    id, number, status, station_id: 'sa', branch_id: null, opening_float_minor: 50_000, counted_cash_minor: null, expected_operational_cash_minor: null, cash_variance_minor: null,
    operational_meter_milliliters: 0, operational_liters: '0', locked_at: null, opened_at: '2026-11-05T03:00:00+00:00', closed_at: null, approved_at: null,
    staff_assignments: [{ user_id: USER_ID }], cash_variance: null, meter_readings: [], tank_readings: [], cash_movements: [],
  });
  const mr = (id: string, nozzle: string, stage: string, value: number, key: string) => ({ id, nozzle_id: nozzle, reading_stage: stage, meter_milliliters: value, measured_at: '2026-11-05T03:05:00+00:00', evidence_key: key });
  const tr = (id: string, tank: string, stage: string, value: number, key: string) => ({ id, tank_id: tank, reading_stage: stage, reading_type: 'physical', quantity_milliliters: value, measured_at: '2026-11-05T03:06:00+00:00', evidence_key: key });
  const openingOf = (i: number) => ml(125_430 + i * 13_700) + i * 250;

  const shifts = new Map<string, Dict>();
  // وردية سابقة معتمدة: مصدر «آخر إغلاق مسجّل» الإرشادي.
  const prev = detailBase('prev', 'SH-0999', 'approved');
  Object.assign(prev, { opened_at: '2026-11-04T03:00:00+00:00', closed_at: '2026-11-04T11:00:00+00:00', approved_at: '2026-11-04T12:00:00+00:00', counted_cash_minor: 50_000, expected_operational_cash_minor: 50_000, cash_variance_minor: 0, cash_variance: { status: 'not_required', variance_direction: 'none' } });
  nozzles.forEach((z, i) => { prev.meter_readings.push(mr(`pc${i}`, z.id, 'closing', openingOf(i), `prev-c-${i}`)); });
  shifts.set('prev', prev);

  const seed = opts.seed ?? 'none';
  if (seed !== 'none') {
    const open = detailBase('s-open', 'SH-1001', 'open');
    if (seed === 'open-opened' || seed === 'ready') {
      nozzles.forEach((z, i) => open.meter_readings.push(mr(`o${i}`, z.id, 'opening', openingOf(i), `awj-ops:m:s-open:${z.id}:opening`)));
      tanks.forEach((t, i) => open.tank_readings.push(tr(`to${i}`, t.id, 'opening', ml(24_000 - i * 1_000), `awj-ops:t:s-open:${t.id}:opening`)));
    }
    if (seed === 'ready') {
      nozzles.forEach((z, i) => open.meter_readings.push(mr(`c${i}`, z.id, 'closing', openingOf(i) + ml(640 + i * 37) + 500, `awj-ops:m:s-open:${z.id}:closing`)));
      tanks.forEach((t, i) => open.tank_readings.push(tr(`tc${i}`, t.id, 'closing', ml(21_300 - i * 500), `awj-ops:t:s-open:${t.id}:closing`)));
    }
    shifts.set('s-open', open);
  }

  const controls: Controls = { fault: null };
  const requests: Array<{ method: string; path: string; branch?: string }> = [];
  const posts: Post[] = [];
  const issues: string[] = [];
  const openKeys = new Map<string, string>();
  const cashKeys = new Map<string, string>();
  let counter = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !/INVALID_KEY|Namespace keys|Failed to load resource/.test(m.text())) issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));

  const user = { id: USER_ID, name: n.user, email: 'fixture@example.test', tenant_id: 'fx-tenant', role: 'cashier', branch_ids: [], warehouse_ids: [], permissions: opts.permissions ?? SELLER };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const rejectWith = (route: Route, message: string, status = 422) => json(route, { message }, status);
  const summary = (d: Dict) => ({ id: d.id, number: d.number, status: d.status, station_id: d.station_id, opening_float_minor: d.opening_float_minor, operational_liters: d.operational_liters, cash_variance_minor: d.cash_variance_minor, opened_at: d.opened_at, closed_at: d.closed_at, approved_at: d.approved_at, cash_variance: d.cash_variance });
  const totals = (d: Dict) => {
    const sum = (type: string) => d.cash_movements.filter((m: Dict) => m.type === type).reduce((a: number, m: Dict) => a + m.amount_minor, 0);
    return d.opening_float_minor + sum('cash_in') - sum('cash_out') - sum('expense');
  };

  /** يطبّق POST على الحالة؛ يعيد الوردية أو رسالة الرفض. */
  function apply(path: string, body: Dict): { ok: true; shift: Dict } | { ok: false; message: string } {
    const fail = (message: string) => ({ ok: false as const, message });
    if (path === '/fuel-stations/shifts/open') {
      if (policy.shift_opening_cash_float_required && body.opening_float_minor === undefined) return fail('سياسة المحطة تتطلب تسجيل float نقدي افتتاحي صريح، ولو كانت قيمته صفراً.');
      const prior = openKeys.get(String(body.idempotency_key));
      if (prior) return { ok: true, shift: shifts.get(prior)! };
      if ([...shifts.values()].some((s) => s.status === 'open')) return fail('توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.');
      counter += 1;
      const created = detailBase(`new-${counter}`, `SH-NEW-${counter}`, 'open');
      created.opening_float_minor = Number(body.opening_float_minor ?? 0);
      created.staff_assignments = [];
      shifts.set(created.id, created);
      openKeys.set(String(body.idempotency_key), created.id);
      return { ok: true, shift: created };
    }
    const m = /^\/fuel-stations\/shifts\/([\w-]+)\/(staff|meter-readings|tank-readings|cash-movements|close)$/.exec(path);
    if (!m) return fail('not found');
    const d = shifts.get(m[1]);
    if (!d) return fail('not found');
    if (d.status !== 'open') return fail('الشفت ليس مفتوحاً ولا يقبل حركة تشغيلية جديدة.');
    if (m[2] === 'staff') {
      if (d.staff_assignments.some((s: Dict) => s.user_id === body.user_id)) return fail('العامل مسند بالفعل إلى هذا الشفت.');
      d.staff_assignments.push({ user_id: body.user_id });
    } else if (m[2] === 'meter-readings') {
      const dup = d.meter_readings.find((r: Dict) => r.evidence_key === body.evidence_key);
      if (dup) return dup.nozzle_id === body.fuel_nozzle_id && dup.reading_stage === body.reading_stage && dup.meter_milliliters === body.meter_milliliters ? { ok: true, shift: d } : fail('مفتاح دليل قراءة العداد استُخدم سابقاً لسجل مختلف.');
      if (d.meter_readings.some((r: Dict) => r.nozzle_id === body.fuel_nozzle_id && r.reading_stage === body.reading_stage)) return fail('قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.');
      d.meter_readings.push(mr(`mr-${d.meter_readings.length + 1}`, String(body.fuel_nozzle_id), String(body.reading_stage), Number(body.meter_milliliters), String(body.evidence_key)));
    } else if (m[2] === 'tank-readings') {
      const dup = d.tank_readings.find((r: Dict) => r.evidence_key === body.evidence_key);
      if (dup) return dup.tank_id === body.fuel_tank_id && dup.reading_stage === body.reading_stage && dup.quantity_milliliters === body.quantity_milliliters ? { ok: true, shift: d } : fail('مفتاح دليل قراءة الخزان استُخدم سابقاً لسجل مختلف.');
      if (d.tank_readings.some((r: Dict) => r.tank_id === body.fuel_tank_id && r.reading_stage === body.reading_stage)) return fail('قراءة الخزان لهذه المرحلة مسجلة بالفعل ولا يعاد استخدامها.');
      d.tank_readings.push(tr(`tr-${d.tank_readings.length + 1}`, String(body.fuel_tank_id), String(body.reading_stage), Number(body.quantity_milliliters), String(body.evidence_key)));
    } else if (m[2] === 'cash-movements') {
      if (cashKeys.has(String(body.idempotency_key))) return { ok: true, shift: d };
      if ((body.type === 'cash_out' || body.type === 'expense') && Number(body.amount_minor) > totals(d)) return fail('لا يمكن إخراج أو تسجيل مصروف نقدي يتجاوز الرصيد التشغيلي المتوقع للشفت.');
      d.cash_movements.push({ id: `cm-${d.cash_movements.length + 1}`, type: body.type, amount_minor: body.amount_minor, reason: body.reason, recorded_at: '2026-11-05T06:00:00+00:00' });
      cashKeys.set(String(body.idempotency_key), d.id);
    } else {
      const need = (flag: boolean, ids: string[], have: Set<string>, label: string) => (flag && ids.some((x) => !have.has(x)) ? `سياسة المحطة تتطلب قراءات ${label} لكل أصول المحطة النشطة قبل إغلاق الشفت.` : null);
      const set = (rows: Dict[], field: string, stage: string) => new Set(rows.filter((r) => r.reading_stage === stage).map((r) => r[field]));
      const error = need(policy.shift_opening_meter_reading_required, nozzles.map((z) => z.id), set(d.meter_readings, 'nozzle_id', 'opening'), 'افتتاحية للعدادات')
        ?? need(policy.shift_closing_meter_reading_required, nozzles.map((z) => z.id), set(d.meter_readings, 'nozzle_id', 'closing'), 'ختامية للعدادات')
        ?? need(policy.shift_opening_tank_reading_required, tanks.map((t) => t.id), set(d.tank_readings, 'tank_id', 'opening'), 'افتتاحية للخزانات')
        ?? need(policy.shift_closing_tank_reading_required, tanks.map((t) => t.id), set(d.tank_readings, 'tank_id', 'closing'), 'ختامية للخزانات');
      if (error) return fail(error);
      let total = 0;
      for (const z of nozzles) {
        const o = d.meter_readings.find((r: Dict) => r.nozzle_id === z.id && r.reading_stage === 'opening');
        const c = d.meter_readings.find((r: Dict) => r.nozzle_id === z.id && r.reading_stage === 'closing');
        if (o && c) { if (c.meter_milliliters < o.meter_milliliters) return fail('قراءة إغلاق العداد لا تكون أقل من قراءة الفتح لنفس الفوهة.'); total += c.meter_milliliters - o.meter_milliliters; }
      }
      const expected = totals(d);
      const variance = Number(body.counted_cash_minor) - expected;
      if (variance !== 0 && !policy.shift_allow_close_with_pending_cash_variance) return fail('سياسة المحطة تمنع إغلاق الشفت قبل حل فرق النقد التشغيلي.');
      Object.assign(d, { status: 'closed', closed_at: '2026-11-05T11:00:00+00:00', counted_cash_minor: body.counted_cash_minor, expected_operational_cash_minor: expected, cash_variance_minor: variance, operational_meter_milliliters: total, operational_liters: String(total / 1000), cash_variance: { status: variance === 0 ? 'not_required' : 'pending_review', variance_direction: variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage' } });
    }
    return { ok: true, shift: d };
  }

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    requests.push({ method, path: p, branch: request.headers()['x-branch-id'] });

    if (p === '/me') return json(route, { user, company: { name: n.company } });
    if (p === '/company') return json(route, { data: { name: n.company, logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });

    if (method === 'POST' && p.startsWith('/fuel-stations/')) {
      const body = (request.postDataJSON() ?? {}) as Dict;
      posts.push({ path: p, body, branch: request.headers()['x-branch-id'] });
      const fault = controls.fault && controls.fault.match.test(p) && controls.fault.times > 0 ? controls.fault : null;
      if (fault) {
        fault.times -= 1;
        if (fault.mode === 'forbidden') return json(route, { message: 'ممنوع' }, 403);
        if (fault.mode === 'reject') return rejectWith(route, fault.message ?? 'رفض');
        const applied = apply(p, body); // يُطبَّق في الخادم ثم يضيع الردّ
        void applied;
        if (fault.mode === 'server_error') return json(route, { message: 'خطأ' }, 503);
        return route.abort('connectionreset');
      }
      const result = apply(p, body);
      return result.ok ? json(route, { data: JSON.parse(JSON.stringify(result.shift)) }, p.endsWith('/close') ? 200 : 201) : rejectWith(route, result.message, result.message === 'not found' ? 404 : 422);
    }

    if (p === '/fuel-stations/stations') return json(route, { data: [station] });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/pumps') return json(route, { data: pumps });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/fuel-stations/nozzles') return json(route, { data: nozzles });
    if (p === '/fuel-stations/prices') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });
    if (/^\/fuel-stations\/stations\/[\w-]+\/settings$/.test(p)) return json(route, { data: policy });
    if (p === '/fuel-stations/shifts') {
      const status = url.searchParams.get('status');
      const rows = [...shifts.values()].filter((s) => !status || s.status === status).sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at)).map(summary);
      return json(route, { data: rows, meta: { current_page: 1, last_page: 1 } });
    }
    const detail = /^\/fuel-stations\/shifts\/([\w-]+)$/.exec(p);
    if (detail) return shifts.has(detail[1]) ? json(route, { data: JSON.parse(JSON.stringify(shifts.get(detail[1]))) }) : json(route, { message: 'not found' }, 404);
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('station_use_erp', '1'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);

  return { requests, posts, issues, controls, shifts, names: n, nozzles, tanks };
}
