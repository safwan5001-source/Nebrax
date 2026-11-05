// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrice, listEffective, listHistory, listSuggestions, PricesError, SAVE_TIMEOUT_MS } from './client';
import { effective, history } from './__fixtures__';

/**
 * يختبر العميل فوق `api()` الحقيقي مع `fetch` معترَض (لا محاكاة لـ`api` نفسها): فيُثبَت المسار والطريقة والترويسات
 * وتصنيف الأخطاء كما تراه الشاشة فعلاً.
 */
const fetchMock = vi.fn();
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const respond = (status: number, body: unknown) => fetchMock.mockImplementation(async () => json(status, body));
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url).replace(/^.*\/api/, ''), init: init as RequestInit & { signal?: AbortSignal } }));
/** يلتقط الرفض كقيمة: `rejects.toMatchObject` على Error يقارن الرسالة لا الحقول المخصصة. */
const failure = async (promise: Promise<unknown>) => (await promise.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e)) as PricesError;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  localStorage.setItem('token', 'tok');
});
afterEach(() => { vi.unstubAllGlobals(); });

const payload = { fuel_station_id: 's1', fuel_product_id: 'p1', price_per_liter_minor: 218, start_now: true as const, idempotency_key: 'fp-key-12345' };
const created = { data: history('h1', 's1', 'p1', 218), meta: { replayed: false, superseded_price_ids: [] } };

describe('reads', () => {
  it('asks for the station scope or the organization default scope with GET and the bearer token, nothing else', async () => {
    fetchMock.mockImplementation(async (url: string) => json(200, String(url).includes('/prices?') ? { data: [history('h1', null, 'p1', 205)] } : { data: [] }));
    await listEffective({ kind: 'station', stationId: 's1' });
    await listEffective({ kind: 'tenant' });
    await listSuggestions({ kind: 'station', stationId: 's1' });
    await listSuggestions({ kind: 'tenant' });
    await listHistory({ kind: 'tenant' }, 'p1', 2);
    expect(calls().map((c) => c.url)).toEqual([
      '/fuel-stations/prices/effective?station_id=s1',
      '/fuel-stations/prices/effective?scope=tenant_default',
      '/fuel-stations/prices/suggestions?station_id=s1',
      '/fuel-stations/prices/suggestions',
      '/fuel-stations/prices?scope=tenant_default&fuel_product_id=p1&page=2',
    ]);
    for (const { init } of calls()) {
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    }
  });

  it('returns validated rows and rejects a response that breaks the contract instead of rendering part of it', async () => {
    respond(200, { data: [effective('s1', 'p1', 218)] });
    expect((await listEffective({ kind: 'tenant' })).data[0].price_per_liter_minor).toBe(218);
    respond(200, { data: [{ fuel_product_id: 'p1', price_per_liter_minor: '218' }] });
    expect((await failure(listEffective({ kind: 'tenant' }))).kind).toBe('invalid_shape');
  });

  it.each([[403, 'forbidden'], [404, 'not_found'], [500, 'server'], [502, 'server']])('classifies HTTP %i as %s', async (status, kind) => {
    respond(status, { message: 'x' });
    expect((await failure(listEffective({ kind: 'tenant' }))).kind).toBe(kind);
  });

  it('classifies a network failure as offline and an abort as timeout', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    expect((await failure(listEffective({ kind: 'tenant' }))).kind).toBe('offline');
    fetchMock.mockImplementationOnce(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    expect((await failure(listEffective({ kind: 'tenant' }))).kind).toBe('timeout');
  });
});

describe('createPrice', () => {
  it('POSTs the payload once with an abort signal and parses the contract', async () => {
    respond(201, created);
    const result = await createPrice(payload);
    expect(result.meta.replayed).toBe(false);
    expect(calls()).toHaveLength(1);
    const { url, init } = calls()[0];
    expect(url).toBe('/fuel-stations/prices');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns a 409/422 into a rejected error carrying the machine-readable reason and body', async () => {
    respond(422, { message: 'تتداخل', reason: 'price_overlap', can_supersede: true, conflicts: [] });
    const error = await failure(createPrice(payload));
    expect(error).toBeInstanceOf(PricesError);
    expect([error.kind, error.status, error.reason]).toEqual(['rejected', 422, 'price_overlap']);
    expect(error.body).toMatchObject({ can_supersede: true });
    respond(409, { message: 'x', reason: 'suggestion_stale' });
    const stale = await failure(createPrice(payload));
    expect([stale.kind, stale.reason]).toEqual(['rejected', 'suggestion_stale']);
  });

  it('a 403 keeps its reason (e.g. organization-scope refusal) for the sheet', async () => {
    respond(403, { message: 'سعر المؤسسة لا يملكه مستخدم مقيَّد' });
    expect((await failure(createPrice(payload))).kind).toBe('forbidden');
  });

  it('aborts after the timeout and reports "timeout" (the outcome is unknown, so the caller keeps the idempotency key)', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    expect((await failure(createPrice(payload, 25))).kind).toBe('timeout');
    expect(SAVE_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000); // مهلة الإنتاج معقولة لشبكة جوال
  });

  it('rejects an unexpected success body', async () => {
    respond(201, { data: { id: 'h1' } });
    expect((await failure(createPrice(payload))).kind).toBe('invalid_shape');
  });
});
