import type { Page, Route } from '@playwright/test';

/**
 * HORIZON-REPORTS — خادم وهمي لمواصفة المتصفح: يحاكي عقد `report-center` (الكتالوج، الحمولة، التصدير، التدقيق) ببيانات اختبار موسومة (لا بيانات حقيقية).
 * يحاكي حذف الأعمدة المالية لمن لا يملك `fuel.sale.view` كما يفعل الخادم (الاختبار الحقيقي لذلك في PHP: FuelReportCenterApiTest).
 */
type Dict = Record<string, unknown>;
export type Locale = 'ar' | 'en';
export const STAFF = ['fuel_stations.view', 'fuel.shift.view'];
export const MANAGER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view'];

const label = (ar: string, en: string) => ({ ar, en });
const def = (key: string, family: string, ar: string, en: string, over: Dict = {}) => ({
  key, family, title: label(ar, en), description: label(`وصف ${ar}`, `About ${en}`), filters: ['station_id', 'from', 'to', 'product_id'], source: 'meter_derived', orientation: 'landscape', thermal: false, ...over,
});
const CATALOG = {
  families: { sales: label('المبيعات', 'Sales'), shifts: label('الورديات', 'Shifts') },
  reports: [
    def('sales.daily', 'sales', 'المبيعات اليومية', 'Daily sales'),
    def('sales.by_product', 'sales', 'المبيعات حسب المنتج', 'Sales by product'),
    def('shifts.log', 'shifts', 'سجل الورديات', 'Shift log', { source: 'operational_records' }),
    def('shifts.closing', 'shifts', 'تقرير إقفال الوردية', 'Shift closing', { source: 'operational_records', thermal: true }),
  ],
};

function payload(key: string, canSeeSales: boolean): Dict {
  const money = canSeeSales;
  const col = (k: string, type: string, ar: string, en: string, extra: Dict = {}) => ({ key: k, type, label: label(ar, en), ...extra });
  const columns = [
    col('period', 'date', 'اليوم', 'Day'), col('station', 'text', 'المحطة', 'Station'), col('shifts', 'int', 'الورديات', 'Shifts', { total: 'sum' }), col('liters', 'liters', 'اللترات', 'Liters', { total: 'sum' }),
    ...(money ? [col('amount', 'money', 'القيمة', 'Value', { total: 'sum' })] : []),
  ];
  const rows = [
    { period: '2027-03-10', station: 'محطة الاختبار', shifts: 1, liters: 100_000, ...(money ? { amount: 23_000 } : {}) },
    { period: '2027-03-11', station: 'محطة الاختبار', shifts: 1, liters: 50_000, ...(money ? { amount: 11_500 } : {}) },
  ];
  const summary = [
    { key: 'shifts', label: label('عدد الورديات', 'Shifts'), type: 'int', value: 2 },
    { key: 'liters', label: label('اللترات', 'Liters'), type: 'liters', value: 150_000 },
    ...(money ? [{ key: 'amount', label: label('قيمة المبيعات', 'Sales value'), type: 'money', value: 34_500 }] : []),
  ];
  const report = CATALOG.reports.find((r) => r.key === key) ?? CATALOG.reports[0];
  return {
    report, generated_at: '2027-03-11T10:00:00+00:00', timezone: 'Asia/Riyadh', timezones: ['Asia/Riyadh'], tenant: { name: 'شركة الاختبار' },
    stations: [{ id: 'sa', name: 'محطة الاختبار', code: 'FX-A' }], period: { from: '2027-03-10', to: '2027-03-11' }, filters: [],
    summary, tables: [{ key: 'daily', title: label('المبيعات اليومية', 'Daily sales'), columns, rows, totals: { shifts: 2, liters: 150_000, ...(money ? { amount: 34_500 } : {}) } }],
    data_quality: { complete: true, gaps: [], notes: [label('تقدير تشغيلي من العدادات.', 'Operational estimate from meters.')] }, truncated: false, source: { kind: report.source },
  };
}

const XLSX_BYTES = Buffer.from('504b0304', 'hex');

export async function mockReportsApi(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; permissions: string[] }) {
  const canSeeSales = opts.permissions.includes('fuel.sale.view');
  const user = { id: 'fx-viewer', name: opts.locale === 'ar' ? 'موظف اختبار' : 'Test Staff', email: 'fx@example.test', role: 'cashier', tenant_id: 'FX', permissions: opts.permissions, branch_ids: [], warehouse_ids: [] };
  const station = { id: 'sa', code: 'FX-A', name: 'محطة الاختبار', status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null, warehouse_id: 'wh1', warehouse: { id: 'wh1', name: 'مخزن', code: 'W' } };
  const requests: Array<{ method: string; path: string; query: string; body?: Dict }> = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    requests.push({ method, path: p, query: url.search, body: method === 'POST' ? (request.postDataJSON() as Dict) : undefined });
    if (p === '/me') return json(route, { user, company: { name: 'شركة الاختبار' } });
    if (p === '/company') return json(route, { data: { name: 'شركة الاختبار', logo: null } });
    if (p === '/branches') return json(route, { data: [], main_branch_id: null });
    if (p === '/fuel-stations/stations') return json(route, { data: [station] });
    if (p === '/fuel-stations/report-center/catalog') return json(route, { data: CATALOG });
    const exp = /^\/fuel-stations\/report-center\/([\w.]+)\/export$/.exec(p);
    if (exp) {
      const csv = url.searchParams.get('format') === 'csv';
      return route.fulfill({ status: 200, contentType: csv ? 'text/csv; charset=UTF-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="fuel-${exp[1].replace('.', '-')}.${csv ? 'csv' : 'xlsx'}"` }, body: csv ? '﻿Day\r\n' : XLSX_BYTES });
    }
    const audit = /^\/fuel-stations\/report-center\/([\w.]+)\/audit$/.exec(p);
    if (audit && method === 'POST') return json(route, { data: { recorded: true } }, 201);
    const show = /^\/fuel-stations\/report-center\/([\w.]+)$/.exec(p);
    if (show) return json(route, { data: payload(show[1], canSeeSales) });
    return json(route, { data: [] });
  });
  await page.addInitScript(([u, theme]) => { localStorage.setItem('token', 'fx'); localStorage.setItem('station_use_erp', JSON.parse(u).id); localStorage.setItem('user', u); localStorage.setItem('theme', theme); }, [JSON.stringify(user), opts.theme] as const);

  return { requests };
}
