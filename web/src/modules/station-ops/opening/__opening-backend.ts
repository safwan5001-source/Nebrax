import { ApiError } from '@/lib/api';
import { createBackend, type TenantData } from '../__test-harness';

/**
 * حزمة اختبار (للاختبارات فقط): خادم وهمي **بحالة** لمستند الرصيد الافتتاحي. يحاكي أشكال استجابة `FuelOpeningBalanceController` وقواعده المثبتة في PR-1:
 * بوابة النشر (404)، idempotency المسودة بالمفتاح والبصمة، المسودة تستبدل المحتوى وتحفظ التكاليف إن غابت، المعاينة تُعيد الموانع والقيد (والتكلفة تغيب لمن لا يراها)،
 * الترحيل مرة واحدة (إعادة الاستدعاء = replayed)، وضياع الردّ بعد التطبيق. قواعد التقييم الفعلية مختبَرة في الخادم (PHP) ولا تُعاد كتابتها هنا.
 */
export interface Post { path: string; method: string; body: Record<string, unknown> }
export interface Line { id: string; tank_id: string; tank_name: string; fuel_product_id: string; quantity_milliliters: number; quantity_liters: string; unit_cost_per_liter_minor: number | null; value_minor: number | null }
export interface Doc {
  id: string; number: string; status: 'draft' | 'posted'; station_id: string; opening_date: string; notes: string | null; allow_zero_cost: boolean; total_milliliters: number;
  total_value_minor: number | null; journal_entry_id: string | null; posted_at: string | null; created_by: string; lines: Line[]; _key?: string;
}
export interface Account { id: string; code: string; name: string; type: string; is_group: boolean; is_active: boolean }

export interface OpeningWorld {
  data: TenantData;
  docs: Doc[];
  accounts: Account[];
  settings: { station: string | null; tenant: string | null };
  gateOpen: boolean;
  canSeeCost: boolean;
  /** منتجات مجمّعها غير فارغ (مانع POOL_NOT_EMPTY عند المعاينة والترحيل). */
  poolNotEmpty: Set<string>;
  posts: Post[];
  gets: string[];
  viewerId: string;
  beforePost?: (post: Post, world: OpeningWorld) => void;
  /** ضياع الردّ بعد تطبيق الكتابة (انقطاع بعد الإرسال). */
  dropReplyAfterApply?: (post: Post) => boolean;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const mlOf = (liters: string) => Math.round(Number(liters) * 1000);
const litersOf = (ml: number) => String(ml / 1000);
const valueOf = (ml: number, cost: number | null) => (cost === null ? null : Math.round((ml * cost) / 1000));

export function connectOpening(world: OpeningWorld, apiMock: { mockImplementation: (fn: (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => Promise<never>) => unknown }) {
  const base = createBackend(world.data);
  let seq = 100;

  const view = (row: Doc): Omit<Doc, '_key'> => {
    const copy = clone(row) as Doc;
    delete copy._key;
    const out = copy as unknown as Record<string, unknown>;
    out.cost_recorded = copy.lines.length > 0 && copy.lines.every((l) => l.unit_cost_per_liter_minor !== null);
    if (!world.canSeeCost) {
      delete out.total_value_minor;
      for (const line of copy.lines) { delete (line as Partial<Line>).unit_cost_per_liter_minor; delete (line as Partial<Line>).value_minor; }
    }
    return copy;
  };

  const tankOf = (id: string) => world.data.tanks.find((t) => t.id === id);

  const evaluate = (row: Doc) => {
    const blockers: Array<Record<string, unknown>> = [];
    const warnings: Array<Record<string, unknown>> = [];
    const effective = world.settings.station ?? world.settings.tenant;
    const account = world.accounts.find((a) => a.id === effective && a.type === 'equity' && a.is_active && !a.is_group);
    if (!account) blockers.push({ code: 'FUEL_OPENING_ACCOUNT_REQUIRED', message: 'x' });
    const productIds = [...new Set(row.lines.map((l) => l.fuel_product_id))];
    const products = productIds.map((pid) => {
      const group = row.lines.filter((l) => l.fuel_product_id === pid);
      const ml = group.reduce((s, l) => s + l.quantity_milliliters, 0);
      const cost = group[0].unit_cost_per_liter_minor;
      if (world.poolNotEmpty.has(pid)) blockers.push({ code: 'FUEL_OPENING_POOL_NOT_EMPTY', message: 'x', fuel_product_id: pid });
      if (cost === null) blockers.push({ code: 'FUEL_OPENING_COST_MISSING', message: 'x', fuel_product_id: pid });
      else if (cost === 0 && !row.allow_zero_cost) blockers.push({ code: 'FUEL_OPENING_ZERO_COST_NOT_ALLOWED', message: 'x', fuel_product_id: pid });
      return { fuel_product_id: pid, name: world.data.products.find((p) => p.id === pid)?.name ?? null, total_milliliters: ml, unit_cost_per_liter_minor: cost, value_minor: valueOf(ml, cost) };
    });
    const total = products.reduce((s, p) => s + (p.value_minor ?? 0), 0);
    return { blockers, warnings, products, total, account };
  };

  const previewOf = (row: Doc) => {
    const e = evaluate(row);
    const out: Record<string, unknown> = {
      ready: e.blockers.length === 0, blockers: e.blockers, warnings: e.warnings,
      products: e.products,
      lines: row.lines.map((l) => ({ line_id: l.id, fuel_tank_id: l.tank_id, tank_name: l.tank_name, fuel_product_id: l.fuel_product_id, quantity_milliliters: l.quantity_milliliters, unit_cost_per_liter_minor: l.unit_cost_per_liter_minor, value_minor: l.value_minor })),
      journal: e.account ? { debit: { account_id: 'inv', code: '1140', name: 'Inventory', role: 'inventory_asset', amount_minor: e.total }, credit: { account_id: e.account.id, code: e.account.code, name: e.account.name, setting: 'fuel_opening_balance_account_id', amount_minor: e.total } } : null,
      total_milliliters: row.lines.reduce((s, l) => s + l.quantity_milliliters, 0), total_value_minor: e.total, not_checked: ['accounting_period_lock'],
    };
    if (!world.canSeeCost) {
      delete out.journal; delete out.total_value_minor;
      for (const key of ['products', 'lines']) for (const item of out[key] as Array<Record<string, unknown>>) { delete item.unit_cost_per_liter_minor; delete item.value_minor; }
    }
    return out;
  };

  const buildLines = (b: Record<string, unknown>, existing?: Doc): Line[] => {
    const lines = b.lines as Array<{ fuel_tank_id: string; quantity_liters: string }>;
    const costs = b.costs as Array<{ fuel_product_id: string; unit_cost_per_liter_minor: number }> | undefined;
    const preserved = new Map<string, number | null>();
    for (const l of existing?.lines ?? []) preserved.set(l.fuel_product_id, l.unit_cost_per_liter_minor);
    return lines.map((l) => {
      const tank = tankOf(l.fuel_tank_id);
      if (!tank) throw new ApiError(422, 'FUEL_OPENING_TANK_INVALID: الخزان غير موجود أو لا يخص المحطة المحددة.', {});
      const ml = mlOf(l.quantity_liters);
      if (ml <= 0) throw new ApiError(422, 'FUEL_OPENING_QUANTITY_INVALID: كمية الخزان يجب أن تكون موجبة.', {});
      const cost = costs ? (costs.find((c) => c.fuel_product_id === tank.fuel_product_id)?.unit_cost_per_liter_minor ?? null) : (preserved.get(tank.fuel_product_id) ?? null);
      return { id: `ln-${++seq}`, tank_id: tank.id, tank_name: tank.name, fuel_product_id: tank.fuel_product_id, quantity_milliliters: ml, quantity_liters: litersOf(ml), unit_cost_per_liter_minor: cost, value_minor: valueOf(ml, cost) };
    });
  };

  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) } as never;
    const [route, search = ''] = path.split('?');
    const method = init?.method ?? 'GET';
    const query = new URLSearchParams(search);

    if (route.startsWith('/fuel-stations/opening-balances') && !world.gateOpen) throw new ApiError(404, 'Not Found', {});

    if (method !== 'GET') {
      const body = (init?.body ?? {}) as Record<string, unknown>;
      const post: Post = { path: route, method, body };
      world.posts.push(post);
      world.beforePost?.(post, world);
      const drop = () => { if (world.dropReplyAfterApply?.(post)) throw new TypeError('Failed to fetch'); };

      if (route === '/fuel-stations/opening-balances' && method === 'POST') {
        const existing = world.docs.find((d) => d._key === body.idempotency_key);
        if (existing) { drop(); return { data: view(existing), meta: { replayed: true } } as never; }
        const lines = buildLines(body);
        const row: Doc = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, number: `FOB-2026-${String(seq).padStart(5, '0')}`, status: 'draft', station_id: String(body.fuel_station_id),
          opening_date: String(body.opening_date), notes: (body.notes as string) ?? null, allow_zero_cost: body.allow_zero_cost === true, total_milliliters: lines.reduce((s, l) => s + l.quantity_milliliters, 0),
          total_value_minor: null, journal_entry_id: null, posted_at: null, created_by: world.viewerId, lines, _key: String(body.idempotency_key),
        };
        world.docs.push(row);
        drop();
        return { data: view(row), meta: { replayed: false } } as never;
      }
      const put = /^\/fuel-stations\/opening-balances\/([\w-]+)$/.exec(route);
      if (put && method === 'PUT') {
        const row = world.docs.find((d) => d.id === put[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        if (row.status !== 'draft') throw new ApiError(422, 'FUEL_OPENING_NOT_DRAFT: لا يُعدَّل ولا يُحذف رصيد افتتاحي مرحَّل.', {});
        row.lines = buildLines(body, row);
        row.opening_date = String(body.opening_date);
        row.notes = (body.notes as string) ?? null;
        row.allow_zero_cost = body.allow_zero_cost === true;
        row.total_milliliters = row.lines.reduce((s, l) => s + l.quantity_milliliters, 0);
        drop();
        return { data: view(row) } as never;
      }
      const postMatch = /^\/fuel-stations\/opening-balances\/([\w-]+)\/post$/.exec(route);
      if (postMatch) {
        const row = world.docs.find((d) => d.id === postMatch[1]);
        if (!row) throw new ApiError(404, 'not found', {});
        if (row.status === 'posted') { drop(); return { data: view(row), meta: { replayed: true } } as never; }
        const e = evaluate(row);
        if (e.blockers.length > 0) throw new ApiError(422, `${e.blockers[0].code}: x`, { message: 'x', reason: 'opening_blocked', blockers: e.blockers });
        row.status = 'posted'; row.total_value_minor = e.total; row.journal_entry_id = 'je-1'; row.posted_at = '2026-11-07T08:00:00+00:00';
        row.lines.forEach((l) => { l.value_minor = valueOf(l.quantity_milliliters, l.unit_cost_per_liter_minor); });
        drop();
        return { data: view(row), meta: { replayed: false } } as never;
      }
      const settings = /^\/fuel-stations\/stations\/([\w-]+)\/settings$/.exec(route);
      if ((settings || route === '/fuel-stations/settings') && method === 'PUT') {
        const id = String(body.fuel_opening_balance_account_id);
        const account = world.accounts.find((a) => a.id === id);
        if (!account || account.type !== 'equity' || !account.is_active || account.is_group) throw new ApiError(422, 'حساب الوقود يجب أن يكون نشطاً وقابلاً للترحيل ومن نفس المستأجر وباتجاهه المحاسبي الصحيح.', {});
        if (settings) world.settings.station = id; else world.settings.tenant = id;
        drop();
        return { data: { fuel_opening_balance_account_id: world.settings.station ?? world.settings.tenant } } as never;
      }
      throw new ApiError(404, 'not found', {});
    }

    world.gets.push(path);
    if (route === '/accounts') return { data: clone(world.accounts) } as never;
    if (route === '/fuel-stations/settings') return { data: { fuel_opening_balance_account_id: world.settings.tenant } } as never;
    const stationSettings = /^\/fuel-stations\/stations\/([\w-]+)\/settings$/.exec(route);
    if (stationSettings) return { data: { fuel_opening_balance_account_id: world.settings.station ?? world.settings.tenant } } as never;
    if (route === '/fuel-stations/opening-balances') {
      const rows = world.docs.filter((d) => !query.get('station_id') || d.station_id === query.get('station_id')).map(view);
      return { data: rows, meta: { current_page: 1, last_page: 1 } } as never;
    }
    const preview = /^\/fuel-stations\/opening-balances\/([\w-]+)\/preview$/.exec(route);
    if (preview) {
      const row = world.docs.find((d) => d.id === preview[1]);
      if (!row) throw new ApiError(404, 'not found', {});
      return { data: previewOf(row) } as never;
    }
    const one = /^\/fuel-stations\/opening-balances\/([\w-]+)$/.exec(route);
    if (one) {
      const row = world.docs.find((d) => d.id === one[1]);
      if (!row) throw new ApiError(404, 'not found', {});
      return { data: view(row) } as never;
    }
    return base.handler(path) as never;
  });

  return { base };
}
