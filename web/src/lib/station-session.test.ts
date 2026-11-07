// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, setToken } from './api';
import { STATION_HOME_PATH, STATION_LOGIN_PATH, currentUser, isStationSession, landingPathForUser, login, logout, stationLogin } from './auth';

// STATION-PIN: جلسة تطبيق المحطات في طبقة العميل — التخزين، الوجهات، الخروج، وانتهاء الجلسة، ودخول البريد كما كان.

const realLocation = window.location;
const assign = vi.fn();
const fetchSpy = vi.fn();
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body, headers: new Headers(), blob: async () => new Blob(['x']) });
const worker = { id: 'u1', name: 'Seller', email: 's@x.test', role: 'staff', permissions: ['fuel_stations.view'], tenant_id: 't1' };

function setPath(pathname: string) {
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, href: `http://localhost${pathname}`, assign } });
}

beforeEach(() => {
  localStorage.clear();
  assign.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  setPath('/fuel-stations/ops/login');
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('stationLogin()', () => {
  it('posts only employee_no and pin to /station/login and stores a station-marked session', async () => {
    fetchSpy.mockResolvedValueOnce(res(200, { token: 'tok-station', user: { ...worker, station_session: true } }));
    const user = await stationLogin('EMP-00042', '482915');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/station\/login$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ employee_no: 'EMP-00042', pin: '482915' });
    expect(user.station_session).toBe(true);
    expect(getToken()).toBe('tok-station');
    expect(currentUser()?.station_session).toBe(true);
    expect(isStationSession()).toBe(true);
    // الـPIN لا يُخزَّن في أي مكان.
    const everything = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(everything).not.toContain('482915');
  });

  it('marks the stored user as a station session even if the server omits the flag', async () => {
    fetchSpy.mockResolvedValueOnce(res(200, { token: 't', user: worker }));
    await stationLogin('1', '482915');
    expect(isStationSession()).toBe(true);
  });

  it('clears the previous session preferences (no inherited active branch)', async () => {
    localStorage.setItem('nibras_active_branch', 'br-old');
    fetchSpy.mockResolvedValueOnce(res(200, { token: 't', user: worker }));
    await stationLogin('1', '482915');
    expect(localStorage.getItem('nibras_active_branch')).toBeNull();
  });
});

describe('landing and logout', () => {
  it('a station session lands on the app; every other session keeps its existing landing', () => {
    expect(landingPathForUser({ role: 'staff', station_session: true })).toBe(STATION_HOME_PATH);
    expect(landingPathForUser({ role: 'owner' })).toBe('/dashboard');
    expect(landingPathForUser({ role: 'self_service' })).toBe('/me');
    expect(landingPathForUser({ role: 'self_service', station_session: true })).toBe(STATION_HOME_PATH);
  });

  it('logout revokes server-side then removes token and user', async () => {
    fetchSpy.mockResolvedValueOnce(res(200, { token: 'tok', user: worker })).mockResolvedValueOnce(res(200, { message: 'ok' }));
    await stationLogin('1', '482915');
    await logout();
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/\/logout$/);
    expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
  });

  it('logout still clears the device when the network fails (shared device is never left signed in)', async () => {
    fetchSpy.mockResolvedValueOnce(res(200, { token: 'tok', user: worker })).mockRejectedValueOnce(new TypeError('offline'));
    await stationLogin('1', '482915');
    await logout();
    expect(getToken()).toBeNull();
    expect(currentUser()).toBeNull();
  });
});

describe('expired session redirect', () => {
  it('inside the station app returns to the PIN login, not the email login', async () => {
    setPath('/fuel-stations/ops/shifts');
    setToken('tok');
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/fuel-stations/shifts')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith(STATION_LOGIN_PATH);
    expect(getToken()).toBeNull();
  });

  it('elsewhere the existing behaviour is unchanged: /login', async () => {
    setPath('/dashboard');
    setToken('tok');
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/invoices')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not loop when already on the PIN login screen', async () => {
    setPath('/fuel-stations/ops/login');
    setToken('tok');
    fetchSpy.mockResolvedValueOnce(res(401));
    await expect(api('/me')).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('the email login is unchanged', () => {
  it('login() still posts email/password to /login and never marks a station session', async () => {
    fetchSpy.mockResolvedValueOnce(res(200, { token: 'erp', user: { id: 'o', name: 'O', email: 'o@x.test', role: 'owner', tenant_id: 't1' } }));
    const user = await login('o@x.test', 'password123');
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/login$/);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ email: 'o@x.test', password: 'password123' });
    expect(user.station_session).toBeUndefined();
    expect(isStationSession()).toBe(false);
    expect(landingPathForUser(user)).toBe('/dashboard');
  });
});
