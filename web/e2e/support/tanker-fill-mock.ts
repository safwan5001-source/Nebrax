import type { Page, Route } from '@playwright/test';

/**
 * TANKER-PR7 — خادم أَوْج الوهمي **بحالة** لمواصفات المتصفح الشاملة لشاشات «تعبئة الصهاريج» في تطبيق المحطات.
 * **بيانات اختبار فقط**: كل الأسماء موسومة (Fixture/تجريبية) ولا تمثل أي مستأجر أو محطة أو صاحب صهريج حقيقي، والاعتراض كامل: لا طلب يصل أي خلفية ولا يُسجَّل شيء في أي بيئة.
 *
 * - يحاكي **شكل** الاستجابات وقواعد الخادم الأساسية فقط (الوردية المفتوحة، idempotency بالمفتاح وبصمة المحتوى، السند المكرر، السعة، البوابة المغلقة). القواعد الحقيقية مختبَرة في PHP.
 * - **بوابة الإنتاج لا تُفتح ولا تُتجاوز**: «البوابة المفتوحة» هنا محاكاة داخل الاعتراض فقط (`gate: 'open'`)؛ الحالات `closed|forbidden|down` تحاكي ما يردّه الخادم عند إغلاقها.
 * - جلسة PIN (`pin: true`) تحاكي `StationSessionBoundary`: أي مسار خارج القائمة البيضاء يُرَدّ 403 ويُسجَّل في `forbidden` (اختبار أن الواجهة لا تطلب ما لا تملكه).
 * - أعطال قابلة للحقن لكل POST: `lost_reply` (يُطبَّق ثم يضيع الردّ) · `abort_before` (يفشل قبل أن يصل) · `server_error` (يُطبَّق ثم 503) · `reject` · `slow`.
 */
export type Locale = 'ar' | 'en';
export type Gate = 'open' | 'closed' | 'forbidden' | 'down';
export type FaultMode = 'lost_reply' | 'abort_before' | 'server_error' | 'reject' | 'slow';
export interface Fault { mode: FaultMode; times: number; status?: number; reason?: string; message?: string; delayMs?: number }
export interface Post { path: string; body: Record<string, any>; branch?: string }
type Dict = Record<string, any>;

export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const OWNER_ASKAR = UID(101);
export const OWNER_BAKR = UID(102);
export const OWNER_CAMEL = UID(103);
export const TANKER_ASKAR = UID(201);
export const TANKER_CAMEL_A = UID(202);
export const TANKER_CAMEL_B = UID(203);
export const TANKER_CAMEL_OFF = UID(204);

/** الصلاحيات الدقيقة (الخادم السلطة؛ هنا فقط ما تقرؤه الواجهة). */
export const FULL = ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record'];
export const VIEW_ONLY = ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.fill.view'];
export const NO_PICK = ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record']; // بلا fuel.tanker.view (لا قراءة أصحاب)
export const NONE = ['fuel_stations.view', 'fuel.shift.view'];

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'موظف تجريبي' : 'Fixture Attendant',
    station: ar ? 'محطة تجريبية أ' : 'Fixture Station A',
    products: ar ? ['ديزل تجريبي', 'وقود تجريبي 2'] : ['Fixture Diesel', 'Fixture Fuel 2'],
    owners: ar ? ['عسكر التجريبي', 'بكر التجريبي', 'جمل التجريبي'] : ['Askar Fixture', 'Bakr Fixture', 'Camel Fixture'],
  };
}

export interface FillRow {
  id: string; number: string; voucher_number: string; status: string; inventory_status: string; fuel_station_id: string; fuel_shift_id: string; fuel_pump_id: string; fuel_nozzle_id: string; fuel_tank_id: string;
  fuel_product_id: string; fuel_tanker_owner_id: string; fuel_tanker_id: string | null; quantity_milliliters: number; quantity_liters: string; capacity_overrun_milliliters: number | null;
  recorded_at: string; voided_at: string | null; owner: Dict | null; tanker: Dict | null; attachments_count: number; _key?: string; _fingerprint?: string;
}

export interface MockOptions {
  baseUrl: string;
  locale: Locale;
  theme?: 'light' | 'dark';
  permissions?: string[];
  /** جلسة تطبيق المحطات (رقم موظف + PIN): توكن `station_token` وقدرة محدودة بالقائمة البيضاء. */
  pin?: boolean;
  gate?: Gate;
  /** بلا وردية مفتوحة. */
  noShift?: boolean;
  policy?: Record<string, unknown>;
  /** عدد أصحاب إضافيين لاختبار التمرير والبحث. */
  extraOwners?: number;
  /** سندات سابقة للوردية الحالية. */
  fills?: number;
  voucherUniqueDisabled?: boolean;
  lookupWithoutMarker?: boolean;
  lookupFails?: boolean;
  /** تأخير (مللي ثانية) على قراءات الأصحاب لاختبار حالات التحميل. */
  slowOwners?: number;
  /** وردية مفتوحة لكن المحطة بلا فوهة مسموحة. */
  noEligibleNozzle?: boolean;
}

export async function mockTankerApi(page: Page, opts: MockOptions) {
  const n = names(opts.locale);
  const gate: Gate = opts.gate ?? 'open';
  const policy = { tanker_selection_required: false, tanker_capacity_overrun_policy: 'allow_with_confirmation', tanker_voucher_unique_scope: 'station', ...opts.policy };
  const permissions = opts.permissions ?? FULL;

  const station = { id: 'sa', code: 'FX-A', name: n.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null };
  const products = n.products.map((name, i) => ({ id: `p${i + 1}`, code: `FX${i + 1}`, name, is_active: true }));
  const pumps = [1, 2].map((i) => ({ id: `u${i}`, fuel_station_id: 'sa', pump_number: String(i), name: null, status: 'active' }));
  const tanks = [{ id: 't1', fuel_station_id: 'sa', fuel_product_id: 'p1', code: 'T1', name: opts.locale === 'ar' ? 'خزان الديزل' : 'Diesel Tank', capacity_milliliters: 30_000_000, minimum_level_milliliters: null, status: 'active' }];
  const nozzleRow = (id: string, pump: string, num: string, over: Dict = {}) => ({ id, fuel_station_id: 'sa', fuel_pump_id: pump, fuel_tank_id: 't1', fuel_product_id: 'p1', nozzle_number: num, status: 'active', allowed_operations: null, effective_operations: ['direct_sale', 'tanker_fill', 'internal_issue'], ...over });
  const nozzles = opts.noEligibleNozzle
    ? [nozzleRow('nz1', 'u1', '1', { allowed_operations: ['direct_sale'], effective_operations: ['direct_sale'] })]
    : [
      nozzleRow('nz1', 'u1', '1'),
      nozzleRow('nz2', 'u1', '2', { allowed_operations: ['direct_sale'], effective_operations: ['direct_sale'] }),
      nozzleRow('nz3', 'u2', '3', { status: 'inactive' }),
      nozzleRow('nz4', 'u2', '4'),
    ];
  const shift = { id: 'sh1', number: 'FSH-0001', status: 'open', station_id: 'sa', opening_float_minor: 0, operational_liters: '0', cash_variance_minor: null, opened_at: '2026-11-14T03:00:00+00:00', closed_at: null, approved_at: null, cash_variance: null };

  const owners: Dict[] = [
    { id: OWNER_ASKAR, name: n.owners[0], code: 'ASK', status: 'active' },
    { id: OWNER_BAKR, name: n.owners[1], code: 'BKR', status: 'active' },
    { id: OWNER_CAMEL, name: n.owners[2], code: 'CML', status: 'active' },
  ];
  for (let i = 0; i < (opts.extraOwners ?? 0); i += 1) owners.push({ id: UID(1000 + i), name: `${opts.locale === 'ar' ? 'صاحب تجريبي' : 'Fixture Owner'} ${String(i + 1).padStart(2, '0')}`, code: `FX${String(i + 1).padStart(3, '0')}`, status: 'active' });
  const tankers: Dict[] = [
    { id: TANKER_ASKAR, fuel_tanker_owner_id: OWNER_ASKAR, plate_number: 'ABJ 1234', capacity_milliliters: 5_000_000, status: 'active' },
    { id: TANKER_CAMEL_A, fuel_tanker_owner_id: OWNER_CAMEL, plate_number: 'KSA 4455', capacity_milliliters: 8_000_000, status: 'active' },
    { id: TANKER_CAMEL_B, fuel_tanker_owner_id: OWNER_CAMEL, plate_number: 'KSA 9001', capacity_milliliters: null, status: 'active' },
    { id: TANKER_CAMEL_OFF, fuel_tanker_owner_id: OWNER_CAMEL, plate_number: 'KSA 0000', capacity_milliliters: 2_000_000, status: 'inactive' },
  ];

  const fills: FillRow[] = [];
  let seq = 0;
  const publicRow = (row: FillRow) => { const copy = JSON.parse(JSON.stringify(row)) as FillRow; delete copy._key; delete copy._fingerprint; return copy; };
  const makeFill = (body: Dict, key: string, fingerprint: string): FillRow => {
    seq += 1;
    const nz = nozzles.find((row) => row.id === body.fuel_nozzle_id);
    const owner = owners.find((row) => row.id === body.fuel_tanker_owner_id) ?? null;
    const tk = tankers.find((row) => row.id === body.fuel_tanker_id) ?? null;
    const quantity = Number(body.quantity_milliliters);
    return {
      id: UID(900 + seq), number: `FTF-2026-${String(seq).padStart(5, '0')}`, voucher_number: String(body.voucher_number), status: 'recorded', inventory_status: 'pending_integration',
      fuel_station_id: 'sa', fuel_shift_id: 'sh1', fuel_pump_id: nz?.fuel_pump_id ?? 'u1', fuel_nozzle_id: String(body.fuel_nozzle_id), fuel_tank_id: 't1', fuel_product_id: 'p1',
      fuel_tanker_owner_id: String(body.fuel_tanker_owner_id), fuel_tanker_id: tk?.id ?? null, quantity_milliliters: quantity,
      quantity_liters: `${Math.trunc(quantity / 1000)}.${String(quantity % 1000).padStart(3, '0')}`,
      capacity_overrun_milliliters: tk?.capacity_milliliters && quantity > tk.capacity_milliliters ? quantity - tk.capacity_milliliters : null,
      recorded_at: '2026-11-14T09:00:00+03:00', voided_at: null, owner: owner ? { id: owner.id, name: owner.name, code: owner.code } : null,
      tanker: tk ? { id: tk.id, plate_number: tk.plate_number, capacity_milliliters: tk.capacity_milliliters } : null, attachments_count: 0, _key: key, _fingerprint: fingerprint,
    };
  };
  for (let i = 0; i < (opts.fills ?? 0); i += 1) {
    const row = makeFill({ fuel_nozzle_id: 'nz1', fuel_tanker_owner_id: i % 2 === 0 ? OWNER_ASKAR : OWNER_BAKR, fuel_tanker_id: i % 2 === 0 ? TANKER_ASKAR : null, quantity_milliliters: 1_500_000 + i * 250_000, voucher_number: `V-${100 + i}` }, `seed-key-${i}`, `seed-${i}`);
    if (i === 2) row.status = 'voided';
    fills.push(row);
  }

  const posts: Post[] = [];
  const requests: Array<{ method: string; path: string; query: string; branch?: string }> = [];
  const forbidden: string[] = [];
  const issues: string[] = [];
  const controls: { fault: Fault | null; lookupFails: boolean; lookupWithoutMarker: boolean; gate: Gate; shiftOpen: boolean; offline: boolean } = { fault: null, lookupFails: opts.lookupFails ?? false, lookupWithoutMarker: opts.lookupWithoutMarker ?? false, gate, shiftOpen: !opts.noShift, offline: false };
  // ضوضاء إلغاء الطلبات عند التنقل/الرجوع/إعادة التحميل (WebKit: «Load failed» لجلب RSC المسبق و«due to access control checks» لطلب قُطع أثناء إلغاء الصفحة): لا خلل في الواجهة،
  // تُسجَّل في `noise` للتقرير ولا تُسقط الاختبار. أي رسالة أخرى تبقى في `issues` وتُسقطه.
  const NAV_ABORT = /Failed to fetch RSC payload|Load failed|due to access control checks/;
  const noise: string[] = [];
  const record = (kind: string, text: string) => (NAV_ABORT.test(text) ? noise : issues).push(`${kind}: ${text.slice(0, 200)}`);
  page.on('console', (m) => { if (m.type() === 'error' && !/INVALID_KEY|Namespace keys|Failed to load resource|net::ERR/.test(m.text())) record('console', m.text()); });
  page.on('pageerror', (e) => record('pageerror', e.message));

  const user = { id: 'fx-attendant', name: n.user, email: 'fixture@example.test', tenant_id: 'fx-tenant', role: 'staff', branch_ids: [], warehouse_ids: [], permissions, employee_id: opts.pin ? 'fx-emp' : null, ...(opts.pin ? { station_session: true } : {}) };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  // جلسة PIN: القراءات والكتابة الوحيدة المسموحة (مرآة `StationSessionBoundary` لمسارات هذه الميزة وما تحتاجه الشاشة من أصول المحطة).
  const PIN_READ = [
    /^\/me$/, /^\/fuel-stations\/(stations|products|pumps|nozzles|tanks|tank-levels|prices|prices\/effective|shifts|tanker-owners|tankers|tanker-fills)$/,
    /^\/fuel-stations\/shifts\/[\w-]+$/, /^\/fuel-stations\/stations\/[\w-]+\/settings$/, /^\/fuel-stations\/tanker-fills\/[0-9a-fA-F-]{36}$/,
  ];
  const PIN_WRITE = [/^\/fuel-stations\/tanker-fills$/, /^\/logout$/];

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    const q = url.searchParams;
    requests.push({ method, path: p, query: url.search, branch: request.headers()['x-branch-id'] });
    if (controls.offline) return route.abort('internetdisconnected');

    if (opts.pin) {
      const allowed = (method === 'GET' || method === 'HEAD' ? PIN_READ : PIN_WRITE).some((re) => re.test(p));
      if (!allowed) { forbidden.push(`${method} ${p}`); return json(route, { message: 'غير مسموح لجلسة المحطة.' }, 403); }
    }
    if (p === '/me') return json(route, { user, company: { name: n.company } });
    if (p === '/company') return json(route, { data: { name: n.company, logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });

    // بوابة النشر والصلاحية (تُحاكى هنا فقط؛ لا شيء يمسّ بوابات الإنتاج).
    if (p.startsWith('/fuel-stations/tanker')) {
      if (controls.gate === 'closed') return json(route, { message: 'غير موجود' }, 404);
      if (controls.gate === 'forbidden') return json(route, { message: 'ممنوع' }, 403);
      if (controls.gate === 'down') return json(route, { message: 'خطأ في الخادم' }, 500);
    }

    if (method === 'POST' && p === '/fuel-stations/tanker-fills') {
      const body = (request.postDataJSON() ?? {}) as Dict;
      posts.push({ path: p, body, branch: request.headers()['x-branch-id'] });
      const fault = controls.fault && controls.fault.times > 0 ? controls.fault : null;
      if (fault) {
        fault.times -= 1;
        if (fault.mode === 'abort_before') return route.abort('connectionreset');
        if (fault.mode === 'reject') return json(route, { message: fault.message ?? 'رفض', reason: fault.reason }, fault.status ?? 422);
        if (fault.mode === 'slow') await new Promise((resolve) => setTimeout(resolve, fault.delayMs ?? 1500));
      }
      const key = String(body.idempotency_key);
      const { idempotency_key: _k, ...rest } = body;
      const fingerprint = JSON.stringify(rest);
      const existing = fills.find((row) => row._key === key);
      let result: { status: number; body: unknown };
      if (existing) {
        result = existing._fingerprint === fingerprint ? { status: 200, body: { data: publicRow(existing), meta: { replayed: true } } } : { status: 409, body: { message: 'مفتاح منع التكرار استُخدم سابقاً بمحتوى مختلف', reason: 'idempotency_key_reused' } };
      } else if (!controls.shiftOpen) {
        result = { status: 422, body: { message: 'لا توجد وردية مفتوحة', reason: 'shift_required' } };
      } else if (!opts.voucherUniqueDisabled && fills.some((row) => row.voucher_number === body.voucher_number)) {
        result = { status: 409, body: { message: 'السند الورقي مسجَّل سابقاً', reason: 'voucher_duplicate' } };
      } else {
        const row = makeFill(body, key, fingerprint);
        fills.push(row);
        result = { status: 201, body: { data: publicRow(row), meta: { replayed: false } } };
      }
      if (fault?.mode === 'lost_reply') return route.abort('connectionreset');
      if (fault?.mode === 'server_error') return json(route, { message: 'خطأ' }, 503);
      return json(route, result.body, result.status);
    }

    switch (p) {
      case '/fuel-stations/stations': return json(route, { data: [station] });
      case '/fuel-stations/products': return json(route, { data: products });
      case '/fuel-stations/pumps': return json(route, { data: pumps });
      case '/fuel-stations/nozzles': return json(route, { data: nozzles });
      case '/fuel-stations/tanks': return json(route, { data: tanks });
      case '/fuel-stations/prices': return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });
      case '/fuel-stations/shifts': return json(route, { data: controls.shiftOpen && shift && q.get('status') === 'open' ? [shift] : [], meta: { current_page: 1, last_page: 1 } });
      case '/fuel-stations/tanker-owners': {
        if (opts.slowOwners) await new Promise((resolve) => setTimeout(resolve, opts.slowOwners));
        const term = (q.get('q') ?? '').toLowerCase();
        const list = owners.filter((row) => (!q.get('status') || row.status === q.get('status')) && (!term || row.name.toLowerCase().includes(term) || (row.code ?? '').toLowerCase().includes(term)));
        return json(route, { data: list.slice(0, 50), meta: { current_page: 1, last_page: list.length > 50 ? 2 : 1 } });
      }
      case '/fuel-stations/tankers': {
        const list = tankers.filter((row) => (!q.get('owner_id') || row.fuel_tanker_owner_id === q.get('owner_id')) && (!q.get('status') || row.status === q.get('status')));
        return json(route, { data: list, meta: { current_page: 1, last_page: 1 } });
      }
      case '/fuel-stations/tanker-fills': {
        const attempt = q.get('attempt_key');
        if (attempt !== null) {
          if (controls.lookupFails) return json(route, { message: 'خطأ' }, 500);
          const mine = fills.filter((row) => row._key === attempt);
          return json(route, { data: mine.map(publicRow), meta: { current_page: 1, last_page: 1 }, ...(controls.lookupWithoutMarker ? {} : { attempt: { applied: true } }) });
        }
        const rows = fills.filter((row) => (!q.get('shift_id') || row.fuel_shift_id === q.get('shift_id')) && (!q.get('voucher_number') || row.voucher_number === q.get('voucher_number')));
        return json(route, { data: rows.map(publicRow), meta: { current_page: 1, last_page: 1 } });
      }
      default: {
        if (/^\/fuel-stations\/stations\/[\w-]+\/settings$/.test(p)) return json(route, { data: policy });
        const one = /^\/fuel-stations\/tanker-fills\/([0-9a-fA-F-]{36})$/.exec(p);
        if (one) {
          const row = fills.find((r) => r.id === one[1]);
          return row ? json(route, { data: publicRow(row) }) : json(route, { message: 'غير موجود' }, 404);
        }
        return json(route, { data: [] });
      }
    }
  });

  await page.addInitScript(([u, theme, pin, tok]) => {
    try {
      localStorage.setItem('theme', theme);
      if (pin === '1') { localStorage.setItem('station_token', tok); localStorage.setItem('station_user', u); } else { localStorage.setItem('token', tok); localStorage.setItem('user', u); localStorage.setItem('station_use_erp', JSON.parse(u).id); }
    } catch { /* تخزين محجوب */ }
  }, [JSON.stringify(user), opts.theme ?? 'light', opts.pin ? '1' : '0', 'fx-token'] as const);

  return { posts, requests, forbidden, issues, noise, controls, fills, owners, tankers, names: n, user };
}

export type TankerMock = Awaited<ReturnType<typeof mockTankerApi>>;
