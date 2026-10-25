// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, fetchPrivateFileUrl, getToken, setToken } from './api';
import { checkStoredSession } from './auth';

// AUTH-REMEMBER-1 hardening: رد متأخر لتوكن قديم لا يمسح ولا يحوّل ولا يحفظ مستخدماً.

const realLocation = window.location;
const assign = vi.fn();
const fetchSpy = vi.fn();
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({
  ok: status < 400, status, json: async () => body, headers: new Headers(headers), blob: async () => new Blob(['x']),
});
const pending = () => {
  let finish: (r: unknown) => void = () => {};
  fetchSpy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  return (r: unknown) => finish(r);
};
const owner = { id: 'u1', name: 'م', email: 'a@b.sa', role: 'owner', permissions: ['*'], tenant_id: 't1' };

beforeEach(() => {
  localStorage.clear();
  assign.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/dashboard', href: 'http://localhost/dashboard', assign } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('api(): 401 for a superseded token', () => {
  it('neither clears the newer token nor redirects', async () => {
    setToken('old');
    const finish = pending();
    const call = api('/x').catch((e) => e);
    setToken('new');
    finish(res(401));
    expect(((await call) as { status: number }).status).toBe(401);
    expect(getToken()).toBe('new');
    expect(assign).not.toHaveBeenCalled();
  });

  it('neither clears nor redirects when the token was removed (logout) meanwhile', async () => {
    setToken('old');
    const finish = pending();
    const call = api('/x').catch((e) => e);
    localStorage.removeItem('token');
    finish(res(401));
    await call;
    expect(assign).not.toHaveBeenCalled();
  });

  it('a 401 for the CURRENT token still clears it and redirects once', async () => {
    setToken('cur');
    fetchSpy.mockResolvedValueOnce(res(401));
    await api('/x').catch(() => {});
    expect(getToken()).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when already on /login', async () => {
    window.location.pathname = '/login';
    setToken('cur');
    fetchSpy.mockResolvedValueOnce(res(401));
    await api('/x').catch(() => {});
    expect(getToken()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('fetchPrivateFileUrl follows the same rule', async () => {
    setToken('old');
    const finish = pending();
    const call = fetchPrivateFileUrl('/files/1').catch((e) => e);
    setToken('new');
    finish(res(401, {}, { 'Content-Type': 'application/json' }));
    await call;
    expect(getToken()).toBe('new');
    expect(assign).not.toHaveBeenCalled();

    setToken('cur');
    fetchSpy.mockResolvedValueOnce(res(401, {}, { 'Content-Type': 'application/json' }));
    await fetchPrivateFileUrl('/files/1').catch(() => {});
    expect(getToken()).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe('checkStoredSession(): token changed during /me', () => {
  it('replaced token: success result is superseded and no user is persisted', async () => {
    setToken('old');
    const finish = pending();
    const check = checkStoredSession();
    setToken('new');
    localStorage.setItem('user', JSON.stringify({ ...owner, id: 'newer' }));
    finish(res(200, { user: owner }));
    expect(await check).toEqual({ status: 'superseded' });
    expect(JSON.parse(localStorage.getItem('user') as string).id).toBe('newer');
    expect(getToken()).toBe('new');
  });

  it('logout during the request: no user is resurrected', async () => {
    setToken('old');
    const finish = pending();
    const check = checkStoredSession();
    localStorage.removeItem('token');
    finish(res(200, { user: owner }));
    expect(await check).toEqual({ status: 'superseded' });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('old-token 401 after replacement: superseded, new token kept, no redirect', async () => {
    setToken('old');
    const finish = pending();
    const check = checkStoredSession();
    setToken('new');
    finish(res(401));
    expect(await check).toEqual({ status: 'superseded' });
    expect(getToken()).toBe('new');
    expect(assign).not.toHaveBeenCalled();
  });

  it('demo started during the request: demo user is not overwritten', async () => {
    setToken('tok');
    const finish = pending();
    const check = checkStoredSession();
    localStorage.setItem('demo', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'demo-user' }));
    finish(res(200, { user: owner }));
    expect(await check).toEqual({ status: 'superseded' });
    expect(JSON.parse(localStorage.getItem('user') as string).id).toBe('demo-user');
  });

  it('unchanged token: valid persists; 401 invalid; network error unavailable and keeps token', async () => {
    setToken('t');
    fetchSpy.mockResolvedValueOnce(res(200, { user: owner }));
    expect((await checkStoredSession()).status).toBe('valid');
    expect(JSON.parse(localStorage.getItem('user') as string).id).toBe('u1');

    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await checkStoredSession()).status).toBe('unavailable');
    expect(getToken()).toBe('t');

    fetchSpy.mockResolvedValueOnce(res(401));
    expect((await checkStoredSession()).status).toBe('invalid');
    expect(getToken()).toBeNull();
  });
});
