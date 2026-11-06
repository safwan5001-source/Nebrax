import type { Page, Route } from '@playwright/test';

/**
 * FUEL-B4 — خادم أَوْج الوهمي **بحالة** لمواصفة الإدارة. **بيانات اختبار فقط** (أسماء موسومة Fixture/تجريبية، لا مستأجر ولا محطة حقيقية)،
 * والاعتراض كامل: لا خلفية ولا كتابة لأي بيانات حقيقية. كل PUT يُسجَّل؛ ويمكن حقن عطل لمرة واحدة عبر `controls.fault`.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;
export interface Controls { fault: null | 'conflict' | 'forbidden' | 'lost_reply'; faultTimes: number }
export interface Put { path: string; body: Dict }

export const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const EMP1 = UID(1);
export const EMP2 = UID(2);
export const EMP3 = UID(3);

const SELLER = ['fuel.shift.cash_count', 'fuel.shift.close', 'fuel.shift.open', 'fuel.shift.view', 'fuel_stations.view'];
const SUPERVISOR = [...SELLER, 'fuel.alerts.view', 'fuel.delivery.create', 'fuel.delivery.view', 'fuel.reading.record', 'fuel.reading.view', 'fuel.reconciliation.create', 'fuel.reconciliation.view', 'fuel.reports.view', 'fuel.sale.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.supplier_invoice.view'].sort();
const MANAGER = [...SUPERVISOR, 'fuel.alerts.manage', 'fuel.delivery.approve', 'fuel.device.view', 'fuel.maintenance.view', 'fuel.reconciliation.approve', 'fuel.safety.view', 'fuel.sale.collect', 'fuel.sale.create', 'fuel.sale.finalize'].sort();
const CATALOG = [...new Set([...MANAGER, 'fuel.sale.price.manage', 'fuel.supplier_invoice.manage', 'fuel.supplier_invoice.match', 'fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage', 'fuel.contract.view', 'fuel.card.view', 'fuel.integration.view'])].sort();

export const ADMIN = ['fuel_stations.view', 'fuel.shift.view', 'fuel.staff.manage', 'fuel.sale.price.manage'];
export const SELLER_USER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    user: ar ? 'مسؤول تجريبي' : 'Fixture Admin',
    stationA: ar ? 'محطة تجريبية أ' : 'Fixture Station A',
    stationB: ar ? 'محطة تجريبية ب' : 'Fixture Station B',
    emps: ar ? ['موظف تجريبي ١', 'موظف تجريبي ٢', 'موظف تجريبي ٣'] : ['Fixture Employee 1', 'Fixture Employee 2', 'Fixture Employee 3'],
    candidate: ar ? 'مرشح تجريبي' : 'Fixture Candidate',
  };
}

export async function mockB4Api(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[] }) {
  const n = names(opts.locale);
  const user = { id: 'fx-admin', name: n.user, email: 'fx-admin@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const stations = [
    { id: 'sa', code: 'FX-A', name: n.stationA, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null },
    { id: 'sb', code: 'FX-B', name: n.stationB, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null },
  ];
  const view = (id: string, name: string, template: string, perms: string[], stationIds: string[], rev: string): Dict => ({
    user: { id, name, email: `${id.slice(-2)}@example.test`, is_active: true }, role: `fuel-staff-${id.slice(-4)}`, template, fuel_permissions: perms, fuel_station_scope: 'assigned', station_ids: stationIds, revision: rev,
  });
  const staff: Dict[] = [view(EMP1, n.emps[0], 'seller', SELLER, ['sa'], 'rev-1'), view(EMP2, n.emps[1], 'supervisor', SUPERVISOR, ['sa', 'sb'], 'rev-2'), view(EMP3, n.emps[2], 'none', [], [], 'rev-3')];
  const templates = {
    templates: [
      { key: 'seller', label_ar: 'بائع', label_en: 'Seller', permissions: SELLER, assignable: true },
      { key: 'supervisor', label_ar: 'مشرف', label_en: 'Supervisor', permissions: SUPERVISOR, assignable: true },
      { key: 'station_manager', label_ar: 'مدير محطة', label_en: 'Station manager', permissions: MANAGER, assignable: true },
    ],
    catalog: CATALOG,
    delegable: CATALOG.filter((k) => !['fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage'].includes(k)),
    reserved: ['fuel.governance.manage', 'fuel.staff.manage'],
  };
  const candidates = [{ id: UID(9), name: n.candidate, email: 'cand@example.test', is_active: true }];
  const audit: Dict[] = Array.from({ length: 25 }, (_, i) => {
    const kind = i % 5;
    const base = { id: `ev-${i}`, occurred_at: `2026-11-06T${String(10 - (i % 9)).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}:00+00:00`, reason: null, denial_reason: null };
    if (kind === 1) return { ...base, action: 'fuel_staff.updated', subject_type: 'fuel_staff', outcome: 'denied', actor: { id: 'fx-m', name: n.emps[1] }, target: { kind: 'user', id: EMP1, name: n.emps[0] }, denial_reason: '403: لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.', changes: [{ key: 'add_permissions', kind: 'list', added: ['fuel.governance.manage'], removed: [], count: 1 }] };
    if (kind === 3) return { ...base, action: 'role.updated', subject_type: 'role', outcome: 'applied', actor: { id: 'fx-admin', name: n.user }, target: { kind: 'role', id: 'role-1', name: opts.locale === 'ar' ? 'دور تجريبي' : 'Fixture role' }, changes: [{ key: 'name', kind: 'scalar', from: 'Old', to: 'New' }] };
    return { ...base, action: 'fuel_staff.updated', subject_type: 'fuel_staff', outcome: 'applied', actor: { id: 'fx-admin', name: n.user }, target: { kind: 'user', id: EMP2, name: n.emps[1] }, reason: kind === 0 ? (opts.locale === 'ar' ? 'تغطية إجازة' : 'Holiday cover') : null, changes: [{ key: 'fuel_permissions', kind: 'list', added: ['fuel.reading.view', 'fuel.reading.record'], removed: ['fuel.alerts.view'], count: 6 }, { key: 'station_ids', kind: 'list', added: ['sb'], removed: [], count: 2 }] };
  });

  const controls: Controls = { fault: null, faultTimes: 0 };
  const puts: Put[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  const issues: string[] = [];
  let rev = 100;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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
    if (p === '/fuel-stations/stations') return json(route, { data: stations });
    if (p === '/fuel-stations/shifts') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });

    if (p.startsWith('/fuel-stations/staff')) {
      if (method === 'PUT') {
        const body = (request.postDataJSON() ?? {}) as Dict;
        puts.push({ path: p, body });
        const id = p.split('/').pop() as string;
        const row = staff.find((s) => s.user.id === id);
        if (controls.fault && controls.faultTimes > 0) {
          controls.faultTimes -= 1;
          if (controls.fault === 'forbidden') return json(route, { message: 'لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.' }, 403);
          if (controls.fault === 'conflict' && row) { row.revision = `rev-${++rev}`; return json(route, { message: 'تغيّر إسناد هذا الموظف', reason: 'staff_revision_conflict', current_revision: row.revision }, 409); }
        }
        if (!row) return json(route, { message: 'not found' }, 404);
        if (body.expected_revision !== row.revision) return json(route, { message: 'x', reason: 'staff_revision_conflict', current_revision: row.revision }, 409);
        const perms = new Set<string>(row.fuel_permissions);
        for (const k of (body.remove_permissions ?? []) as string[]) perms.delete(k);
        for (const k of (body.add_permissions ?? []) as string[]) perms.add(k);
        row.fuel_permissions = [...perms].sort();
        if (Array.isArray(body.station_ids)) row.station_ids = [...body.station_ids].sort();
        row.template = templates.templates.find((t) => [...t.permissions].sort().join('|') === row.fuel_permissions.join('|'))?.key ?? (row.fuel_permissions.length ? 'custom' : 'none');
        row.revision = `rev-${++rev}`;
        if (controls.fault === 'lost_reply' && controls.faultTimes > 0) { controls.faultTimes -= 1; return route.abort('connectionreset'); }
        return json(route, { data: JSON.parse(JSON.stringify(row)) });
      }
      if (p === '/fuel-stations/staff') return json(route, { data: staff });
      if (p === '/fuel-stations/staff/templates') return json(route, { data: templates });
      if (p === '/fuel-stations/staff/candidates') return json(route, { data: candidates });
      if (p === '/fuel-stations/staff/audit') {
        const per = Number(url.searchParams.get('per_page') ?? 25);
        const pg = Number(url.searchParams.get('page') ?? 1);
        const outcome = url.searchParams.get('outcome');
        const rows = audit.filter((e) => !outcome || e.outcome === outcome);
        return json(route, { data: rows.slice((pg - 1) * per, pg * per), meta: { current_page: pg, last_page: Math.max(1, Math.ceil(rows.length / per)), per_page: per, total: rows.length } });
      }
      const row = staff.find((s) => s.user.id === p.split('/').pop());
      return row ? json(route, { data: JSON.parse(JSON.stringify(row)) }) : json(route, { message: 'not found' }, 404);
    }
    if (method !== 'GET') issues.push(`unexpected ${method} ${p}`); // قراءات الغلاف العامة (أيقونة الشركة…) لا تعنينا؛ أي كتابة غير متوقعة تُفشل
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);

  return { controls, puts, requests, issues, staff, names: n };
}
