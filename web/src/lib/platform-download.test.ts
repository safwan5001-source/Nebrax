// @vitest-environment jsdom
/**
 * H15-04 — جلسة منصة الإدارة أثناء تنزيل تصدير التدقيق.
 *
 * كل ما هنا **اختبارات مموَّهة**: `fetch` مُستبدَل، فلا يثبت شيئاً عن الخادم الحقيقي. سلوك الخادم الحقيقي
 * (200 مع Accept، 401 JSON مع Accept، 500 HTML بدونه) موثّق وموثَّق قياسه في تقرير H15-04 من تشغيل فعلي.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { platformApi, platformDownloadFile } from './platform-api';

const CSV = '﻿occurred_at,scope,tenant_id,batch_id,event_type,stage,status,reason_code,safe_message\r\n2026-10-13T10:00:00+00:00,platform,,,retention,run,ok,,done\r\n';
const HTML_500 = '<!DOCTYPE html><html><body><h1>Server Error</h1><pre>Symfony\\Component\\Routing\\Exception\\RouteNotFoundException at /var/www/app/secret.php:42</pre></body></html>';
const readBytes = (blob: Blob) => new Promise<number[]>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer))); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
const assign = vi.fn();
const createObjectURL = vi.fn((_blob: Blob) => 'blob:platform/test');
const revokeObjectURL = vi.fn();
let pathname = '/platform/document-operations';

const csvBlob = new Blob([CSV], { type: 'text/csv; charset=UTF-8' });
const csvResponse = () => ({ ok: true, status: 200, blob: async () => csvBlob });
const errorResponse = (status: number, body: unknown, extra: Record<string, unknown> = {}) => ({
  ok: false,
  status,
  json: vi.fn(async () => { if (body === undefined) throw new SyntaxError('Unexpected token <'); return body; }),
  text: vi.fn(async () => HTML_500),
  blob: vi.fn(),
  ...extra,
});
const seedSessions = () => {
  localStorage.setItem('platform_token', 'platform-secret-token');
  localStorage.setItem('platform_administrator', JSON.stringify({ id: 'a1', name: 'Ops', email: 'ops@example.test' }));
  // ERP / tenant side of the same browser: must never be touched by a platform sign-out.
  localStorage.setItem('token', 'erp-tenant-token');
  localStorage.setItem('user', JSON.stringify({ id: 'u1' }));
  localStorage.setItem('nibras_active_branch', 'branch-7');
};
const downloads: string[] = [];

beforeEach(() => {
  localStorage.clear();
  seedSessions();
  assign.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  downloads.length = 0;
  pathname = '/platform/document-operations';
  Object.defineProperty(window, 'location', { configurable: true, value: { get pathname() { return pathname; }, assign } });
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const expectErpUntouched = () => {
  expect(localStorage.getItem('token')).toBe('erp-tenant-token');
  expect(localStorage.getItem('user')).toBe(JSON.stringify({ id: 'u1' }));
  expect(localStorage.getItem('nibras_active_branch')).toBe('branch-7');
};

describe('platformDownloadFile (mocked fetch)', () => {
  it('sends Accept: application/json and the platform bearer token, and downloads the same blob under the same file name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(csvResponse());
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await platformDownloadFile('/platform/document-audit/export', 'platform-document-audit.csv');

    expect(outcome).toBe('downloaded');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/platform\/document-audit\/export$/);
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer platform-secret-token' });
    expect(init.method).toBeUndefined(); // still a plain GET
    // the file is untouched: same content, same type, same name, the same one-click mechanism
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBe(csvBlob); // the very blob the server sent, not a copy or a re-typed one
    expect(await readBytes(blob)).toEqual(Array.from(new TextEncoder().encode(CSV))); // byte for byte, BOM and CRLF included
    expect(downloads).toEqual(['platform-document-audit.csv']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:platform/test');
    expect(document.querySelector('a[download]')).toBeNull();
    // a successful download changes no session
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem('platform_token')).toBe('platform-secret-token');
    expectErpUntouched();
  });

  it('sends Accept even when there is no platform token, and no Authorization header', async () => {
    localStorage.removeItem('platform_token');
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, { message: 'Unauthenticated.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(platformDownloadFile('/platform/document-audit/export', 'x.csv')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
  });

  it('401: clears the platform session only, goes to the platform login, and starts no download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, { message: 'Unauthenticated.' })));

    const failure = await platformDownloadFile('/platform/document-audit/export', 'x.csv').catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe(''); // the page shows its own translated text, not the server's English
    expect(localStorage.getItem('platform_token')).toBeNull();
    expect(localStorage.getItem('platform_administrator')).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/platform/login');
    expect(downloads).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expectErpUntouched();
  });

  it('401 on the login page itself clears the session but does not redirect again', async () => {
    pathname = '/platform/login';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, { message: 'Unauthenticated.' })));
    await expect(platformDownloadFile('/platform/document-audit/export', 'x.csv')).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem('platform_token')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('403 stays a permission refusal: the session is kept, there is no redirect and no download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(403, { message: 'This action is not allowed.' })));

    const failure = await platformDownloadFile('/platform/document-audit/export', 'x.csv').catch((e) => e);

    expect((failure as ApiError).status).toBe(403);
    expect(localStorage.getItem('platform_token')).toBe('platform-secret-token');
    expect(localStorage.getItem('platform_administrator')).not.toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expectErpUntouched();
  });

  it('500 with an HTML error page: no body is read, nothing from it reaches the error, the session is kept', async () => {
    const response = errorResponse(500, undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const failure = await platformDownloadFile('/platform/document-audit/export', 'x.csv').catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(500);
    expect(response.json).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
    expect((failure as ApiError).message).toBe('');
    expect(JSON.stringify((failure as ApiError).body)).toBe('{}');
    for (const text of [(failure as ApiError).message, JSON.stringify((failure as ApiError).body), String(failure)]) {
      expect(text).not.toMatch(/Symfony|RouteNotFound|secret\.php|<html|<!DOCTYPE/i);
    }
    expect(localStorage.getItem('platform_token')).toBe('platform-secret-token');
    expect(assign).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('500 with a JSON error (a debug backend would put SQL or a trace in it): the message is not passed on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500, { message: 'SQLSTATE[23000]: Integrity constraint violation ... (SQL: insert into ...)', trace: ['/var/www/app/x.php'] })));
    const failure = await platformDownloadFile('/platform/document-audit/export', 'x.csv').catch((e) => e);
    expect((failure as ApiError).message).toBe('');
    expect(JSON.stringify((failure as ApiError).body)).not.toMatch(/SQLSTATE|trace|x\.php/);
  });

  it('other client errors keep the server message (for example a rate limit)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429, { message: 'Too Many Attempts.' })));
    const failure = await platformDownloadFile('/platform/document-audit/export', 'x.csv').catch((e) => e);
    expect((failure as ApiError).status).toBe(429);
    expect((failure as ApiError).message).toBe('Too Many Attempts.');
    expect(localStorage.getItem('platform_token')).toBe('platform-secret-token');
    expect(assign).not.toHaveBeenCalled();
  });

  it('preview (demo) mode neither requests nor downloads', async () => {
    localStorage.setItem('demo', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await platformDownloadFile('/platform/document-audit/export', 'x.csv')).toBe('demo-unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });
});

describe('platformApi after the shared sign-out helper (mocked fetch)', () => {
  it('still clears only the platform session and redirects once on a 401, and throws the same error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthenticated.' }) }));

    const failure = await platformApi('/platform/overview').catch((e) => e);

    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe('Unauthenticated.');
    expect(localStorage.getItem('platform_token')).toBeNull();
    expect(localStorage.getItem('platform_administrator')).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/platform/login');
    expectErpUntouched();
  });
});
