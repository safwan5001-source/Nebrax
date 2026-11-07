import type { Page, Route } from '@playwright/test';

/**
 * STATION-PIN — خادم أَوْج الوهمي **بحالة** لرحلة دخول تطبيق المحطات. بيانات اختبار موسومة فقط (لا مستأجر ولا موظف حقيقي)، والاعتراض كامل.
 * يحاكي عقد الخادم: دخول برقم موظف + PIN برد فشل واحد، 429 بعد 6 محاولات خاطئة للموظف نفسه (تحديد معدل لا قفل)، توكن جلسة محطة يعمل على
 * `/me` و`/logout` و`/fuel-stations/*` فقط ويردّ 403 على غيرها كما يفعل `StationSessionBoundary`، وإبطال التوكن عند الخروج.
 */
export type Locale = 'ar' | 'en';
type Dict = Record<string, any>;

export const EMP_A = { no: 'EMP-00042', pin: '482915', id: 'fx-user-a' };
export const EMP_B = { no: 'EMP-00077', pin: '739204', id: 'fx-user-b' };
const PERMS = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.reading.view'];

export function names(locale: Locale) {
  const ar = locale === 'ar';
  return {
    company: ar ? 'مؤسسة تجريبية' : 'Fixture Co.',
    a: ar ? 'بائع تجريبي أ' : 'Fixture Seller A',
    b: ar ? 'بائع تجريبي ب' : 'Fixture Seller B',
    station: ar ? 'محطة تجريبية' : 'Fixture Station',
  };
}

export async function mockStationLoginApi(page: Page, opts: { baseUrl: string; locale: Locale; theme: 'light' | 'dark'; offline?: boolean }) {
  const n = names(opts.locale);
  const users: Dict = {
    [EMP_A.id]: { id: EMP_A.id, name: n.a, email: 'a@example.test', role: 'staff', permissions: PERMS, employee_id: 'e-a', tenant_id: 'FX', preferences: { locale: opts.locale, theme: opts.theme } },
    [EMP_B.id]: { id: EMP_B.id, name: n.b, email: 'b@example.test', role: 'staff', permissions: PERMS, employee_id: 'e-b', tenant_id: 'FX', preferences: { locale: opts.locale, theme: opts.theme } },
  };
  const tokens = new Map<string, string>(); // token → user id
  const failures = new Map<string, number>();
  const calls: Array<{ method: string; path: string; auth: string | null }> = [];
  const forbidden: string[] = []; // طلبات خارج حدّ جلسة المحطات
  const logins: Dict[] = [];
  let seq = 0;

  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  const station = { id: '00000000-0000-4000-8000-0000000000b1', code: 'FX-A', name: n.station, status: 'active', branch_id: null, city: null, region: null, timezone: 'Asia/Riyadh', license_number: null, license_expires_at: null };

  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: opts.baseUrl }]);
  await page.addInitScript((theme) => { if (!localStorage.getItem('theme')) localStorage.setItem('theme', theme); }, opts.theme);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^.*\/api/, '');
    const method = request.method();
    const auth = request.headers()['authorization'] ?? null;
    calls.push({ method, path: p, auth });

    if (p === '/station/login' && method === 'POST') {
      const body = (request.postDataJSON() ?? {}) as Dict;
      logins.push(body);
      const emp = [EMP_A, EMP_B].find((e) => e.no === String(body.employee_no).trim());
      const key = String(body.employee_no).toLowerCase();
      const tries = (failures.get(key) ?? 0);
      if (tries >= 5) return json(route, { message: 'محاولات خاطئة كثيرة.', reason: 'too_many_attempts' }, 429, { 'Retry-After': '60' });
      if (!emp || emp.pin !== body.pin) {
        failures.set(key, tries + 1);
        return json(route, { message: 'رقم الموظف أو رمز PIN غير صحيح.', reason: 'invalid_credentials' }, 422);
      }
      failures.delete(key);
      const token = `fx-token-${++seq}`;
      tokens.set(token, emp.id);
      return json(route, { token, user: { ...users[emp.id], station_session: true } });
    }

    const token = auth?.replace(/^Bearer /, '') ?? '';
    const userId = tokens.get(token);
    if (!userId) return json(route, { message: 'Unauthenticated.' }, 401);

    if (p === '/logout' && method === 'POST') { tokens.delete(token); return json(route, { message: 'ok' }); }
    if (p === '/me') return json(route, { user: { ...users[userId], station_session: true, branch_ids: [], warehouse_ids: [] }, company: { name: n.company } });
    if (p.startsWith('/fuel-stations/') && method === 'GET') {
      if (p === '/fuel-stations/stations') return json(route, { data: [station] });
      if (p === '/fuel-stations/shifts') return json(route, { data: [], meta: { current_page: 1, last_page: 1 } });
      return json(route, { data: [] });
    }
    forbidden.push(`${method} ${p}`); // أي مسار آخر يردّه الخادم الحقيقي 403 لجلسة المحطات
    return json(route, { message: 'جلسة تطبيق المحطات لا تصل إلى هذا المسار.' }, 403);
  });

  return { calls, forbidden, logins, tokens, names: n, users };
}
