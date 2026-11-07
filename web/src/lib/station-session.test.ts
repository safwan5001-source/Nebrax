// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken } from './api';
import { STATION_HOME_PATH, STATION_LOGIN_PATH, checkStoredSession, continueStationWithErpSession, currentUser, erpSessionHint, isAuthenticated, isStationSession, login, logout, stationLogin } from './auth';

// STATION-PIN — عزل اعتماد تطبيق المحطات عن جلسة أَوْج في المتصفح (المصدر نفسه): مفاتيح مستقلة، دخول/خروج مستقلان، انتهاء الصلاحية، تغيّر المستأجر.

const realLocation = window.location;
const assign = vi.fn();
const fetchSpy = vi.fn();
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body, headers: new Headers(), blob: async () => new Blob(['x']) });
const erpUser = { id: 'erp-1', name: 'ERP Owner', email: 'o@x.test', role: 'owner', permissions: ['*'], tenant_id: 'T1' };
const worker = (id: string, tenant = 'T1') => ({ id, name: `Worker ${id}`, email: `${id}@x.test`, role: 'staff', permissions: ['fuel_stations.view'], tenant_id: tenant });

function setPath(pathname: string) {
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, href: `http://localhost${pathname}`, assign } });
}
const ERP = '/dashboard';
const OPS = '/fuel-stations/ops';
const ls = (key: string) => localStorage.getItem(key);

beforeEach(() => {
  localStorage.clear();
  assign.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  setPath(ERP);
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** جلسة أَوْج حقيقية مخزَّنة (كأن مديراً دخل بالبريد في تبويب آخر). */
async function erpSignIn(token = 'erp-token') {
  setPath(ERP);
  fetchSpy.mockResolvedValueOnce(res(200, { token, user: erpUser }));
  await login('o@x.test', 'password123');
}
async function stationSignIn(id: string, token: string, tenant = 'T1') {
  setPath(STATION_LOGIN_PATH);
  fetchSpy.mockResolvedValueOnce(res(200, { token, user: { ...worker(id, tenant), station_session: true } }));
  return stationLogin(`EMP-${id}`, '482915');
}

describe('stationLogin()', () => {
  it('posts only employee_no and pin and stores the session under its OWN keys', async () => {
    const user = await stationSignIn('a', 'tok-station');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/station\/login$/);
    expect(JSON.parse(init.body)).toEqual({ employee_no: 'EMP-a', pin: '482915' });
    expect(user.station_session).toBe(true);
    expect(ls('station_token')).toBe('tok-station');
    expect(JSON.parse(ls('station_user') as string).station_session).toBe(true);
    expect(ls('token')).toBeNull();
    expect(ls('user')).toBeNull();
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain('482915');
  });
});

describe('two sessions in the same browser origin', () => {
  it('a station login neither overwrites nor signs out the ERP session (and keeps its branch and preview flag)', async () => {
    await erpSignIn();
    localStorage.setItem('nibras_active_branch', 'br-erp');
    await stationSignIn('a', 'tok-station');

    expect(ls('token')).toBe('erp-token');
    expect(JSON.parse(ls('user') as string).id).toBe('erp-1');
    expect(ls('nibras_active_branch')).toBe('br-erp');
    setPath(ERP);
    expect(getToken()).toBe('erp-token');
    expect(currentUser()?.id).toBe('erp-1');
    expect(currentUser()?.station_session).toBeUndefined();
    setPath(OPS);
    expect(getToken()).toBe('tok-station');
    expect(currentUser()?.id).toBe('a');
    expect(isStationSession()).toBe(true);
  });

  it('an ERP login afterwards does not overwrite or sign out the station session', async () => {
    await stationSignIn('a', 'tok-station');
    await erpSignIn('erp-token-2');
    expect(ls('station_token')).toBe('tok-station');
    expect(JSON.parse(ls('station_user') as string).id).toBe('a');
    setPath(OPS);
    expect(getToken()).toBe('tok-station');
    setPath(ERP);
    expect(getToken()).toBe('erp-token-2');
  });

  it('the station app never reads the ERP session implicitly (shared device)', async () => {
    await erpSignIn();
    setPath(OPS);
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
    expect(erpSessionHint()).toEqual({ name: 'ERP Owner' }); // يُعرض «المتابعة بها» كخيار صريح فقط
  });

  it('after an explicit opt-in the station app uses the ERP session, without copying or changing it', async () => {
    await erpSignIn();
    setPath(OPS);
    continueStationWithErpSession();
    expect(getToken()).toBe('erp-token');
    expect(currentUser()?.id).toBe('erp-1');
    expect(ls('station_token')).toBeNull();
    // وإن دخل موظف بـPIN لاحقاً فاعتماده هو الأول.
    await stationSignIn('a', 'tok-station');
    setPath(OPS);
    expect(getToken()).toBe('tok-station');
  });

  it('the station session is invisible outside the station app', async () => {
    await stationSignIn('a', 'tok-station');
    setPath(ERP);
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);
    expect(isStationSession()).toBe(false);
  });
});

describe('independent sign-out', () => {
  it('station logout revokes the station token on the server and clears only the station keys', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-station');
    setPath(OPS);
    fetchSpy.mockResolvedValueOnce(res(200, { message: 'ok' }));
    await logout();

    const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect(String(url)).toMatch(/\/logout$/);
    expect(init.headers.Authorization).toBe('Bearer tok-station');
    expect(ls('station_token')).toBeNull();
    expect(ls('station_user')).toBeNull();
    expect(ls('token')).toBe('erp-token');
    expect(JSON.parse(ls('user') as string).id).toBe('erp-1');
  });

  it('ERP logout revokes the ERP token and leaves the station session untouched', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-station');
    setPath(ERP);
    fetchSpy.mockResolvedValueOnce(res(200, { message: 'ok' }));
    await logout();

    expect(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1].headers.Authorization).toBe('Bearer erp-token');
    expect(ls('token')).toBeNull();
    expect(ls('station_token')).toBe('tok-station');
    expect(JSON.parse(ls('station_user') as string).id).toBe('a');
  });

  it('leaving the station app after an ERP opt-in sends no logout request and keeps the ERP session', async () => {
    await erpSignIn();
    setPath(OPS);
    continueStationWithErpSession();
    const before = fetchSpy.mock.calls.length;
    await logout();
    expect(fetchSpy.mock.calls.length).toBe(before);
    expect(ls('token')).toBe('erp-token');
    expect(ls('station_use_erp')).toBeNull();
    expect(getToken()).toBeNull();
  });

  it('the ERP opt-in never bleeds into a PIN session or a later employee switch', async () => {
    await erpSignIn();
    setPath(OPS);
    continueStationWithErpSession();
    expect(ls('station_use_erp')).toBe('erp-1');
    expect(getToken()).toBe('erp-token');

    // دخول PIN يمسح الموافقة: الاعتماد الفعّال محطات فقط.
    await stationSignIn('a', 'tok-a');
    expect(ls('station_use_erp')).toBeNull();
    setPath(OPS);
    expect(getToken()).toBe('tok-a');
    expect(currentUser()?.id).toBe('a');

    // خروج الموظف (أو تبديله): لا رجوع إلى هوية أَوْج.
    fetchSpy.mockResolvedValueOnce(res(200, { message: 'ok' }));
    await logout();
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
    await stationSignIn('b', 'tok-b');
    setPath(OPS);
    fetchSpy.mockResolvedValueOnce(res(200, { message: 'ok' }));
    await logout();
    expect(getToken()).toBeNull();
    expect(ls('token')).toBe('erp-token'); // جلسة أَوْج نفسها لم تُمسّ طوال ذلك
  });

  it('the opt-in is bound to the AWJ user who approved it: another AWJ user (or none) invalidates it', async () => {
    await erpSignIn();
    setPath(OPS);
    continueStationWithErpSession();
    expect(getToken()).toBe('erp-token');

    // مستخدم أَوْج آخر دخل في تبويب آخر.
    localStorage.setItem('user', JSON.stringify({ ...erpUser, id: 'erp-2', name: 'Someone Else' }));
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
    expect(isAuthenticated()).toBe(false);

    // وإن زالت جلسة أَوْج كلياً.
    localStorage.setItem('user', JSON.stringify(erpUser));
    expect(getToken()).toBe('erp-token');
    localStorage.removeItem('token');
    expect(getToken()).toBeNull();
  });

  it('opting in without an AWJ session does nothing', () => {
    setPath(OPS);
    continueStationWithErpSession();
    expect(ls('station_use_erp')).toBeNull();
  });

  it('station logout clears the device even when the network fails (shared device is never left signed in)', async () => {
    await stationSignIn('a', 'tok-station');
    setPath(OPS);
    fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
    await logout();
    expect(ls('station_token')).toBeNull();
    expect(ls('station_user')).toBeNull();
  });

  it('switching employee replaces the first station session and leaves ERP alone', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-a');
    await stationSignIn('b', 'tok-b');
    expect(ls('station_token')).toBe('tok-b');
    expect(JSON.parse(ls('station_user') as string).id).toBe('b');
    expect(ls('token')).toBe('erp-token');
  });
});

describe('expired tokens', () => {
  it('a 401 inside the station app clears only the station session and returns to the PIN login', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-station');
    setPath('/fuel-stations/ops/shifts');
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/fuel-stations/shifts')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith(STATION_LOGIN_PATH);
    expect(ls('station_token')).toBeNull();
    expect(ls('station_user')).toBeNull();
    expect(ls('token')).toBe('erp-token');
  });

  it('a 401 in the ERP clears only the ERP session and returns to /login (unchanged behaviour)', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-station');
    setPath('/invoices');
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/invoices')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
    expect(ls('token')).toBeNull();
    expect(ls('station_token')).toBe('tok-station');
  });

  it('does not loop on the PIN login screen itself', async () => {
    await stationSignIn('a', 'tok-station');
    setPath(STATION_LOGIN_PATH);
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/me')).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });

  it('a 401 for a superseded station token neither clears the newer session nor redirects', async () => {
    await stationSignIn('a', 'tok-a');
    setPath(OPS);
    let finish: (r: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const call = api('/fuel-stations/shifts').catch((e) => e);
    await stationSignIn('b', 'tok-b');
    setPath(OPS);
    finish(res(401));
    await call;
    expect(ls('station_token')).toBe('tok-b');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('tenant changes', () => {
  it('a station login for another company replaces the station session only', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-a', 'T1');
    await stationSignIn('z', 'tok-z', 'T2');
    setPath(OPS);
    expect(currentUser()?.tenant_id).toBe('T2');
    expect(getToken()).toBe('tok-z');
    expect(JSON.parse(ls('user') as string).tenant_id).toBe('T1');
  });

  it('a 403 from /me (host belongs to another company) is not an expiry: credentials are kept and nothing redirects', async () => {
    await stationSignIn('a', 'tok-a');
    setPath(OPS);
    fetchSpy.mockResolvedValueOnce(res(403, { message: 'لا يوجد مستأجر مرتبط بالحساب.' }));
    expect(await checkStoredSession()).toEqual({ status: 'unavailable' });
    expect(ls('station_token')).toBe('tok-a');
    expect(assign).not.toHaveBeenCalled();
  });

  it('a validated /me refresh updates the station user, never the ERP user', async () => {
    await erpSignIn();
    await stationSignIn('a', 'tok-a');
    setPath(OPS);
    fetchSpy.mockResolvedValueOnce(res(200, { user: { ...worker('a'), name: 'Renamed', station_session: true } }));
    expect((await checkStoredSession()).status).toBe('valid');
    expect(JSON.parse(ls('station_user') as string).name).toBe('Renamed');
    expect(JSON.parse(ls('user') as string).name).toBe('ERP Owner');
  });
});

describe('station requests are independent of the ERP preview mode and active branch', () => {
  it('sends no X-Branch-Id and ignores the ERP demo flag while using a station token', async () => {
    await stationSignIn('a', 'tok-station');
    localStorage.setItem('nibras_active_branch', 'br-erp');
    localStorage.setItem('demo', '1');
    setPath(OPS);
    fetchSpy.mockResolvedValueOnce(res(200, { data: [] }));
    await api('/fuel-stations/stations');
    expect(fetchSpy).toHaveBeenCalled();
    const headers = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1].headers;
    expect(headers['X-Branch-Id']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer tok-station');
  });

  it('ERP requests still send the active branch', async () => {
    await erpSignIn();
    localStorage.setItem('nibras_active_branch', 'br-erp');
    fetchSpy.mockResolvedValueOnce(res(200, { data: [] }));
    await api('/invoices');
    expect(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1].headers['X-Branch-Id']).toBe('br-erp');
  });
});

describe('the email login is unchanged', () => {
  it('posts email/password to /login, stores under token/user, marks no station session', async () => {
    await erpSignIn();
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/login$/);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ email: 'o@x.test', password: 'password123' });
    expect(ls('token')).toBe('erp-token');
    expect(ls('station_token')).toBeNull();
    expect(isStationSession()).toBe(false);
    expect(STATION_HOME_PATH).toBe('/fuel-stations/ops');
  });
});
