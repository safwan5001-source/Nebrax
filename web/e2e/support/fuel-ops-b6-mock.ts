import type { Page, Route } from '@playwright/test';

/**
 * FUEL-B6 — خادم أَوْج الوهمي **بحالة** لمواصفة مستويات الخزانات. **بيانات اختبار فقط** (أسماء موسومة تجريبية، لا مستأجر ولا محطة حقيقية)،
 * والاعتراض كامل: لا خلفية ولا كتابة لأي بيانات حقيقية. كل POST يُسجَّل. يحاكي عقد الخادم: idempotency بمفتاح الدليل، رفض ما فوق السعة،
 * حساب `tank-levels` من القراءات، وسجل مرقَّم.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;
export interface Post { path: string; method: string; body: Dict }

export const TANK_OK = '00000000-0000-4000-8000-0000000000a1';
export const TANK_REVIEW = '00000000-0000-4000-8000-0000000000a2';
export const TANK_EMPTY = '00000000-0000-4000-8000-0000000000a3';

/** مشرف: يشاهد ويسجّل. */
export const RECORDER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.reading.view', 'fuel.reading.record'];
/** بائع: يشاهد المراقبة والسجل فقط. */
export const VIEWER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'];

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'موظف تجريبي' : 'Fixture User',
    other: ar ? 'مشرف تجريبي' : 'Fixture Supervisor',
    station: ar ? 'محطة تجريبية أ' : 'Fixture Station A',
    product: ar ? 'وقود تجريبي' : 'Fixture Fuel',
    tanks: ar ? ['خزان تجريبي ١', 'خزان تجريبي ٢', 'خزان تجريبي ٣'] : ['Fixture Tank 1', 'Fixture Tank 2', 'Fixture Tank 3'],
  };
}

const NOW = Date.parse('2026-11-06T12:00:00+00:00');
const liters = (ml: number) => String(ml / 1000);

export async function mockB6Api(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[]; staleAfter?: number | null }) {
  const n = names(opts.locale);
  const user = { id: 'fx-viewer', name: n.user, email: 'fx@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const station = { id: 'sa', code: 'FX-A', name: n.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null };
  const tanks = [
    { id: TANK_OK, code: 'T1', name: n.tanks[0], capacity: 30_000_000, safe: 28_500_000, minimum: 3_000_000, dead: 500_000 },
    { id: TANK_REVIEW, code: 'T2', name: n.tanks[1], capacity: 20_000_000, safe: 19_000_000, minimum: 4_000_000, dead: 500_000 },
    { id: TANK_EMPTY, code: 'T3', name: n.tanks[2], capacity: 15_000_000, safe: 14_250_000, minimum: 0, dead: 0 },
  ];
  const readings: Dict[] = [
    { id: 'r1', fuel_tank_id: TANK_OK, reading_type: 'physical', quantity_milliliters: 18_750_000, evidence_key: 'fx-1', evidence: { method: 'dipstick', note: n.other }, recorded_by: 'fx-other', measured_at: '2026-11-06T09:00:00+00:00' },
    { id: 'r2', fuel_tank_id: TANK_OK, reading_type: 'atg', quantity_milliliters: 18_700_000, evidence_key: 'fx-2', evidence: { method: 'atg_console' }, recorded_by: 'fx-other', measured_at: '2026-11-06T08:00:00+00:00' },
    { id: 'r3', fuel_tank_id: TANK_REVIEW, reading_type: 'physical', quantity_milliliters: 2_100_000, evidence_key: 'fx-3', evidence: { method: 'gauge' }, recorded_by: 'fx-other', measured_at: '2026-11-05T05:00:00+00:00' },
  ];

  const posts: Post[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  const issues: string[] = [];
  let seq = 10;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const row = (r: Dict) => ({ id: r.id, reading_type: r.reading_type, quantity_milliliters: r.quantity_milliliters, quantity_liters: liters(r.quantity_milliliters), measured_at: r.measured_at, recorded_by: r.recorded_by, recorder: { id: r.recorded_by, name: r.recorded_by === 'fx-viewer' ? n.user : n.other }, evidence: r.evidence ?? null });
  const latestOf = (tankId: string, type?: string) => readings.filter((r) => r.fuel_tank_id === tankId && (!type || r.reading_type === type)).sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1))[0];
  const level = (t: (typeof tanks)[number]) => {
    const latest = latestOf(t.id);
    const q: number | null = latest ? latest.quantity_milliliters : null;
    const flags: string[] = [];
    if (q !== null) {
      if (q > t.safe) flags.push('above_safe_capacity');
      if (t.minimum > 0 && q < t.minimum) flags.push('below_minimum_level');
      if (t.dead > 0 && q < t.dead) flags.push('below_dead_stock');
    }
    const age = latest ? Math.floor((NOW - Date.parse(latest.measured_at)) / 1000) : null;
    const stale = opts.staleAfter ?? null;
    return {
      tank: { id: t.id, code: t.code, name: t.name, status: 'active', capacity_milliliters: t.capacity, capacity_liters: liters(t.capacity), safe_capacity_milliliters: t.safe, minimum_level_milliliters: t.minimum, dead_stock_milliliters: t.dead },
      station: { id: 'sa', code: 'FX-A', name: n.station }, fuel_product: { id: 'p1', code: 'FX1', name: n.product },
      latest: latest ? row(latest) : null,
      latest_by_type: { physical: latestOf(t.id, 'physical') ? row(latestOf(t.id, 'physical')) : null, atg: latestOf(t.id, 'atg') ? row(latestOf(t.id, 'atg')) : null },
      level: {
        fill_basis_points: q === null ? null : Math.floor((q * 10000 + Math.floor(t.capacity / 2)) / t.capacity),
        available_milliliters: q === null ? null : Math.max(t.capacity - q, 0), available_liters: q === null ? null : liters(Math.max(t.capacity - q, 0)),
        safe_available_milliliters: q === null ? null : Math.max(t.safe - q, 0), age_seconds: age,
        freshness: !latest ? 'none' : stale === null ? 'unrated' : (age as number) > stale * 60 ? 'stale' : 'fresh', stale_after_minutes: stale, flags, needs_review: flags.length > 0,
      },
    };
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

    if (method === 'POST' && p === '/fuel-stations/readings') {
      const body = (request.postDataJSON() ?? {}) as Dict;
      posts.push({ path: p, method, body });
      const t = tanks.find((x) => x.id === body.fuel_tank_id);
      if (!t) return json(route, { message: 'not found' }, 404);
      const quantity = Math.round(Number(body.quantity_liters) * 1000);
      const existing = readings.find((r) => r.evidence_key === body.evidence_key);
      if (existing) return existing.fuel_tank_id === t.id && existing.quantity_milliliters === quantity ? json(route, { data: existing }, 200) : json(route, { message: 'FUEL_READING_EVIDENCE_MISMATCH: مفتاح دليل القياس مستخدم مسبقاً.' }, 422);
      if (quantity > t.capacity) return json(route, { message: 'FUEL_READING_EXCEEDS_CAPACITY: الكمية المقاسة تتجاوز سعة الخزان المعتمدة ولا تُقبل.' }, 422);
      const made = { id: `r${++seq}`, fuel_tank_id: t.id, reading_type: body.reading_type, quantity_milliliters: quantity, evidence_key: body.evidence_key, evidence: body.evidence ?? null, recorded_by: 'fx-viewer', measured_at: '2026-11-06T12:00:00+00:00' };
      readings.push(made);
      return json(route, { data: made }, 201);
    }
    if (method !== 'GET') { issues.push(`unexpected ${method} ${p}`); return json(route, { message: 'not found' }, 404); }

    if (p === '/fuel-stations/tank-levels') return json(route, { data: tanks.map(level), meta: { generated_at: '2026-11-06T12:00:00+00:00' } });
    if (p === '/fuel-stations/readings') {
      const q = url.searchParams;
      const per = Number(q.get('per_page') ?? 10);
      const rows = readings.filter((r) => (!q.get('fuel_tank_id') || r.fuel_tank_id === q.get('fuel_tank_id')) && (!q.get('reading_type') || r.reading_type === q.get('reading_type'))).sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1));
      const page = Number(q.get('page') ?? 1);
      return json(route, {
        data: rows.slice((page - 1) * per, page * per).map((r) => ({ ...row(r), fuel_tank_id: r.fuel_tank_id, evidence_key: r.evidence_key, flags: [], created_at: r.measured_at })),
        meta: { current_page: page, last_page: Math.max(1, Math.ceil(rows.length / per)), total: rows.length },
      });
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);

  return { posts, requests, issues, readings, names: n };
}
