import type { Page, Route } from '@playwright/test';

/**
 * TANKER-PR2 — خادم وهمي لمواصفة المتصفح البصرية: يحاكي عقد PR-1 (أصحاب الصهاريج/الصهاريج/ربط الشركات) ببيانات اصطناعية فقط.
 * لا يمثل منطق الخادم (عزل المستأجر والصلاحيات يُثبَتان في اختبارات PHP لـPR-1)؛ هنا يُتحقَّق من الواجهة: التخطيط والحمولات وحالات البوابة والصلاحيات.
 */
export type Locale = 'ar' | 'en';
export const MANAGER = ['fuel_stations.view', 'fuel.tanker.view', 'fuel.tanker.manage'];
export const VIEWER = ['fuel_stations.view', 'fuel.tanker.view'];
type Dict = Record<string, unknown>;
export type Mode = 'ok' | 'gate_closed' | 'error';

export const OWNER_A = '11111111-1111-4111-8111-111111111111';
export const OWNER_B = '11111111-1111-4111-8111-111111111112';
const PARTNER_A = '44444444-4444-4444-8444-444444444444';
const PARTNER_B = '55555555-5555-4555-8555-555555555555';
const PARTNER_C = '66666666-6666-4666-8666-666666666666';

export async function mockTankerApi(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[]; mode?: Mode }) {
  const mode: Mode = opts.mode ?? 'ok';
  const user = { id: 'fx-user', name: opts.locale === 'ar' ? 'مستخدم اختبار' : 'Test User', email: 'fx@example.test', role: 'manager', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const owners: Dict[] = [
    { id: OWNER_A, code: 'TO-1', name: opts.locale === 'ar' ? 'مالك تجريبي أ' : 'Sample Owner A', status: 'active', phone: '0500000001', notes: null, created_at: '2026-01-05T09:00:00Z' },
    { id: OWNER_B, code: 'TO-2', name: opts.locale === 'ar' ? 'مالك تجريبي ب' : 'Sample Owner B', status: 'inactive', phone: '0500000002', notes: null, created_at: '2026-01-06T09:00:00Z' },
  ];
  const tankers: Dict[] = [
    { id: '22222222-2222-4222-8222-222222222221', fuel_tanker_owner_id: OWNER_A, plate_number: 'TNK-1001', plate_country: 'SA', capacity_milliliters: 20_000_000, status: 'active', notes: null, created_at: '2026-01-06T09:00:00Z' },
    { id: '22222222-2222-4222-8222-222222222222', fuel_tanker_owner_id: OWNER_A, plate_number: 'TNK-1002', plate_country: 'SA', capacity_milliliters: 12_000_000, status: 'suspended', notes: null, created_at: '2026-01-07T09:00:00Z' },
  ];
  const links: Dict[] = [
    { id: '33333333-3333-4333-8333-333333333331', fuel_tanker_owner_id: OWNER_A, partner_id: PARTNER_A, partner: { id: PARTNER_A, name: opts.locale === 'ar' ? 'شركة تجريبية أ' : 'Sample Company A' }, valid_from: '2026-01-01', valid_to: null, is_active: true, note: null, end_reason: null, created_at: '2026-01-01T00:00:00Z' },
    { id: '33333333-3333-4333-8333-333333333332', fuel_tanker_owner_id: OWNER_A, partner_id: PARTNER_B, partner: { id: PARTNER_B, name: opts.locale === 'ar' ? 'شركة تجريبية ب' : 'Sample Company B' }, valid_from: '2026-01-01', valid_to: '2026-05-31', is_active: false, note: null, end_reason: null, created_at: '2026-01-01T00:00:00Z' },
  ];
  const customers = [PARTNER_A, PARTNER_B, PARTNER_C].map((id, i) => ({ id, name: (opts.locale === 'ar' ? 'شركة تجريبية ' : 'Sample Company ') + 'ABC'[i], code: `C${i + 1}`, is_active: true }));
  const requests: Array<{ method: string; path: string; query: string; body?: Dict }> = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const paged = (rows: Dict[]) => ({ data: rows, meta: { current_page: 1, last_page: 1, per_page: 50, total: rows.length } });
  let seq = 100;

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    const body = ['POST', 'PUT'].includes(method) ? (request.postDataJSON() as Dict) : undefined;
    requests.push({ method, path: p, query: url.search, body });
    if (p === '/me') return json(route, { user, company: { name: 'شركة الاختبار' } });
    if (p === '/company') return json(route, { data: { name: 'شركة الاختبار', logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/partners') return json(route, paged(customers));
    if (p.startsWith('/fuel-stations/tanker') || p.startsWith('/fuel-stations/tankers')) {
      if (mode === 'gate_closed') return json(route, { message: 'Not Found' }, 404);
      if (mode === 'error') return json(route, { message: 'Server Error' }, 500);
      const owner = /^\/fuel-stations\/tanker-owners\/([\w-]+)$/.exec(p);
      const ownerLinks = /^\/fuel-stations\/tanker-owners\/([\w-]+)\/company-links$/.exec(p);
      const endLink = /^\/fuel-stations\/tanker-owners\/([\w-]+)\/company-links\/([\w-]+)\/end$/.exec(p);
      if (p === '/fuel-stations/tanker-owners') {
        if (method === 'POST') { const row = { id: `99999999-9999-4999-8999-${String(++seq).padStart(12, '0')}`, code: null, status: 'active', notes: null, created_at: '2026-11-10T00:00:00Z', ...body }; owners.unshift(row); return json(route, { data: row }, 201); }
        const q = (url.searchParams.get('q') ?? '').toLowerCase(), st = url.searchParams.get('status');
        return json(route, paged(owners.filter((o) => (!q || String(o.name).toLowerCase().includes(q)) && (!st || o.status === st))));
      }
      if (owner) { const o = owners.find((x) => x.id === owner[1]); return o ? json(route, { data: o }) : json(route, { message: 'Not Found' }, 404); }
      if (p === '/fuel-stations/tankers') {
        if (method === 'POST') { const row = { id: `88888888-8888-4888-8888-${String(++seq).padStart(12, '0')}`, plate_country: 'SA', notes: null, status: 'active', created_at: '2026-11-10T00:00:00Z', ...body }; tankers.push(row); return json(route, { data: row }, 201); }
        return json(route, paged(tankers.filter((t) => t.fuel_tanker_owner_id === url.searchParams.get('owner_id'))));
      }
      if (ownerLinks) {
        if (method === 'POST') { const c = customers.find((x) => x.id === body?.partner_id); const row = { id: `77777777-7777-4777-8777-${String(++seq).padStart(12, '0')}`, fuel_tanker_owner_id: ownerLinks[1], partner: c ? { id: c.id, name: c.name } : null, valid_from: '2026-11-10', valid_to: null, is_active: true, note: null, end_reason: null, created_at: '2026-11-10T00:00:00Z', ...body }; links.push(row); return json(route, { data: row }, 201); }
        return json(route, paged(links.filter((l) => l.fuel_tanker_owner_id === ownerLinks[1])));
      }
      if (endLink && method === 'POST') { const l = links.find((x) => x.id === endLink[2]); if (!l) return json(route, { message: 'Not Found' }, 404); l.valid_to = (body?.valid_to as string) ?? '2026-11-10'; l.is_active = false; return json(route, { data: l }); }
    }
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);
  return { requests };
}
