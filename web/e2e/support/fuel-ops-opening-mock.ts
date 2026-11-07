import type { Page, Route } from '@playwright/test';

/**
 * PR-2 (معالج الرصيد الافتتاحي) — خادم مُعترَض ببيانات اختبار موسومة (للفحص البصري والسلوكي فقط). كميات المحطة المرجعية في المهمة
 * (30,000 / 15,555 / 31,000 لتر، سعة 34,000) تُكتب هنا وفي المواصفة فقط؛ لا شيء منها في الإنتاج. لا يتصل بأي بيئة حية.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FINANCE = ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost', 'fuel.governance.manage', 'accounts.view', 'fuel.sale.price.manage'];
export const CAP = 34_000_000;

export async function mockOpeningApi(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[]; gateOpen?: boolean; poolNotEmpty?: boolean }) {
  const ar = opts.locale === 'ar';
  const user = { id: 'fx-fin', name: ar ? 'مستخدم تجريبي' : 'Fixture User', email: 'fx@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const stations = [{ id: 'sa', code: 'FX-A', name: ar ? 'محطة تجريبية' : 'Fixture Station', status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null }];
  const products = [{ id: 'pa', code: 'A', name: ar ? 'وقود أ' : 'Fuel A', is_active: true }, { id: 'pb', code: 'B', name: ar ? 'وقود ب' : 'Fuel B', is_active: true }, { id: 'pc', code: 'C', name: ar ? 'وقود ج' : 'Fuel C', is_active: true }];
  const tanks = [
    { id: 'ta', fuel_station_id: 'sa', fuel_product_id: 'pa', code: 'T1', name: ar ? 'خزان 1' : 'Tank 1', capacity_milliliters: CAP, status: 'active' },
    { id: 'tb', fuel_station_id: 'sa', fuel_product_id: 'pb', code: 'T2', name: ar ? 'خزان 2' : 'Tank 2', capacity_milliliters: CAP, status: 'active' },
    { id: 'tc', fuel_station_id: 'sa', fuel_product_id: 'pc', code: 'T3', name: ar ? 'خزان 3' : 'Tank 3', capacity_milliliters: CAP, status: 'active' },
  ];
  const accounts = [
    { id: 'a1', code: '3130', name: ar ? 'أرصدة افتتاحية' : 'Opening equity', type: 'equity', is_group: false, is_active: true },
    { id: 'a2', code: '3140', name: ar ? 'رأس المال' : 'Owner capital', type: 'equity', is_group: false, is_active: true },
    { id: 'a3', code: '1140', name: ar ? 'المخزون' : 'Inventory', type: 'asset', is_group: false, is_active: true },
  ];
  const settings: { station: string | null; tenant: string | null } = { station: null, tenant: null };
  const docs: Dict[] = [];
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const issues: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const gate = opts.gateOpen !== false;
  const canCost = opts.permissions.includes('products.view_cost');
  let seq = 0;

  const preview = (doc: Dict) => {
    const blockers: Dict[] = [];
    const account = accounts.find((a) => a.id === (settings.station ?? settings.tenant));
    if (!account) blockers.push({ code: 'FUEL_OPENING_ACCOUNT_REQUIRED', message: 'x' });
    const byProduct = new Map<string, { ml: number; cost: number | null }>();
    for (const l of doc.lines) { const e = byProduct.get(l.fuel_product_id) ?? { ml: 0, cost: l.unit_cost_per_liter_minor }; e.ml += l.quantity_milliliters; byProduct.set(l.fuel_product_id, e); }
    const prods = [...byProduct.entries()].map(([id, e]) => {
      if (opts.poolNotEmpty && id === 'pa') blockers.push({ code: 'FUEL_OPENING_POOL_NOT_EMPTY', message: 'x', fuel_product_id: id });
      if (e.cost === null) blockers.push({ code: 'FUEL_OPENING_COST_MISSING', message: 'x', fuel_product_id: id });
      return { fuel_product_id: id, name: products.find((p) => p.id === id)?.name, total_milliliters: e.ml, unit_cost_per_liter_minor: e.cost, value_minor: e.cost === null ? null : Math.round((e.ml * e.cost) / 1000) };
    });
    const total = prods.reduce((s, p) => s + (p.value_minor ?? 0), 0);
    const out: Dict = {
      ready: blockers.length === 0, blockers, warnings: [], products: prods,
      lines: doc.lines.map((l: Dict) => ({ line_id: l.id, fuel_tank_id: l.tank_id, tank_name: l.tank_name, fuel_product_id: l.fuel_product_id, quantity_milliliters: l.quantity_milliliters, unit_cost_per_liter_minor: l.unit_cost_per_liter_minor, value_minor: l.value_minor })),
      journal: account ? { debit: { code: '1140', name: ar ? 'المخزون' : 'Inventory', role: 'inventory_asset', amount_minor: total }, credit: { code: account.code, name: account.name, setting: 'fuel_opening_balance_account_id', amount_minor: total } } : null,
      total_milliliters: doc.total_milliliters, total_value_minor: total, not_checked: ['accounting_period_lock'],
    };
    if (!canCost) { delete out.journal; delete out.total_value_minor; for (const k of ['products', 'lines']) for (const i of out[k]) { delete i.unit_cost_per_liter_minor; delete i.value_minor; } }
    return out;
  };

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    const body = method === 'GET' ? undefined : (request.postDataJSON() ?? {}) as Dict;
    requests.push({ method, path: p, body });
    if (p === '/me') return json(route, { user, company: { name: ar ? 'شركة تجريبية' : 'Fixture Co' } });
    if (p === '/company') return json(route, { data: { name: ar ? 'شركة تجريبية' : 'Fixture Co', logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/products') return json(route, { data: products });
    if (p === '/fuel-stations/pumps' || p === '/fuel-stations/nozzles' || p === '/fuel-stations/shifts') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });
    if (p === '/fuel-stations/tanks') return json(route, { data: tanks });
    if (p === '/accounts') return json(route, { data: accounts });
    if (p === '/fuel-stations/settings') return json(route, { data: { fuel_opening_balance_account_id: settings.tenant } });
    if (/^\/fuel-stations\/stations\/[\w-]+\/settings$/.test(p)) {
      if (method === 'PUT') { settings.station = body!.fuel_opening_balance_account_id; }
      return json(route, { data: { fuel_opening_balance_account_id: settings.station ?? settings.tenant } });
    }
    if (p.startsWith('/fuel-stations/opening-balances')) {
      if (!gate) return json(route, { message: 'Not Found' }, 404);
      if (p === '/fuel-stations/opening-balances' && method === 'GET') return json(route, { data: docs, meta: { current_page: 1, last_page: 1 } });
      if (p === '/fuel-stations/opening-balances' && method === 'POST') {
        const lines = body!.lines.map((l: Dict) => { const t = tanks.find((x) => x.id === l.fuel_tank_id)!; const ml = Math.round(Number(l.quantity_liters) * 1000); const c = body!.costs?.find((x: Dict) => x.fuel_product_id === t.fuel_product_id)?.unit_cost_per_liter_minor ?? null; return { id: `l${++seq}`, tank_id: t.id, tank_name: t.name, fuel_product_id: t.fuel_product_id, quantity_milliliters: ml, quantity_liters: String(ml / 1000), unit_cost_per_liter_minor: c, value_minor: c === null ? null : Math.round((ml * c) / 1000) }; });
        const doc = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, number: 'FOB-2026-00001', status: 'draft', station_id: 'sa', opening_date: body!.opening_date, notes: null, allow_zero_cost: false, total_milliliters: lines.reduce((s: number, l: Dict) => s + l.quantity_milliliters, 0), lines };
        docs.push(doc);
        return json(route, { data: doc, meta: { replayed: false } }, 201);
      }
      const prev = /^\/fuel-stations\/opening-balances\/([\w-]+)\/preview$/.exec(p);
      if (prev) { const d = docs.find((x) => x.id === prev[1]); return d ? json(route, { data: preview(d) }) : json(route, { message: 'nf' }, 404); }
      const post = /^\/fuel-stations\/opening-balances\/([\w-]+)\/post$/.exec(p);
      if (post) { const d = docs.find((x) => x.id === post[1]); if (!d) return json(route, { message: 'nf' }, 404); d.status = 'posted'; d.total_value_minor = preview(d).total_value_minor; return json(route, { data: d, meta: { replayed: false } }); }
      const one = /^\/fuel-stations\/opening-balances\/([\w-]+)$/.exec(p);
      if (one) { const d = docs.find((x) => x.id === one[1]); return d ? json(route, { data: d }) : json(route, { message: 'nf' }, 404); }
    }
    if (method !== 'GET') issues.push(`unexpected ${method} ${p}`);
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);
  return { requests, issues, docs, settings };
}
