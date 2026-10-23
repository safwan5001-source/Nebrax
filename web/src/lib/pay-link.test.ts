// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PayLinkError, fetchPayLink, formatPayAmount, idempotencyKeyFor, isSafeCheckoutUrl, minorToRiyalText, parseRiyalToMinor, startPayAttempt,
} from './pay-link';

afterEach(() => vi.unstubAllGlobals());

describe('minorToRiyalText / formatPayAmount', () => {
  it('converts halalas to riyal text with integer arithmetic', () => {
    expect(minorToRiyalText(115000)).toBe('1150.00');
    expect(minorToRiyalText(5)).toBe('0.05');
    expect(minorToRiyalText(100)).toBe('1.00');
    expect(minorToRiyalText(0)).toBe('0.00');
  });
  it('formats SAR with the official symbol and other currencies with their code', () => {
    expect(formatPayAmount(115000, 'SAR')).toBe('1,150.00 ⃁');
    expect(formatPayAmount(250, 'usd')).toBe('2.50 USD');
  });
});

describe('parseRiyalToMinor', () => {
  it.each([
    ['500', 50000], ['500.5', 50050], ['500.50', 50050], ['0.05', 5], ['1,5', 150], ['١٢٣٫٤٥', 12345], ['۱۰۰', 10000], ['  12.30 ', 1230],
  ])('parses %s → %i', (input, minor) => expect(parseRiyalToMinor(input)).toBe(minor));
  it.each(['', '0', '0.00', '-5', '1.234', 'abc', '1e3', '12.', '.5', '1 000', '1234567890'])('rejects %j', (input) => expect(parseRiyalToMinor(input)).toBeNull());
  it('never goes through floating point (no 0.1+0.2 drift)', () => {
    expect(parseRiyalToMinor('1150.29')).toBe(115029);
    expect(parseRiyalToMinor('19.99')).toBe(1999);
  });
});

describe('isSafeCheckoutUrl', () => {
  it('accepts https only', () => {
    expect(isSafeCheckoutUrl('https://moyasar.com/i/inv_1')).toBe(true);
    for (const bad of ['http://x.test', 'javascript:alert(1)', 'data:text/html,x', '//evil.test', 'not a url', '', null, undefined]) {
      expect(isSafeCheckoutUrl(bad as string | null | undefined)).toBe(false);
    }
  });
});

describe('idempotencyKeyFor', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  };
  it('is stable per (token, amount) and matches the server contract', () => {
    const s = memory();
    const a = idempotencyKeyFor('tokenAAAAAAAAAAAAAAAA', undefined, s);
    expect(idempotencyKeyFor('tokenAAAAAAAAAAAAAAAA', undefined, s)).toBe(a);
    expect(idempotencyKeyFor('tokenAAAAAAAAAAAAAAAA', 5000, s)).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  });
  it('survives blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(idempotencyKeyFor('tokenBBBBBBBBBBBBBBBB', undefined, blocked)).toMatch(/^pay-/);
    expect(idempotencyKeyFor('tokenBBBBBBBBBBBBBBBB', undefined, null)).toMatch(/^pay-/);
  });
});

describe('client calls', () => {
  it('sends no credentials, no auth header and no referrer, and unwraps data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'open' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('token', 'SECRET-USER-TOKEN');

    await expect(fetchPayLink('abc')).resolves.toEqual({ status: 'open' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/pay\/v1\/abc$/);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(JSON.stringify(init.headers)).not.toMatch(/Authorization|SECRET-USER-TOKEN/);
    localStorage.clear();
  });
  it('maps server error codes, rate limits and network failures to PayLinkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'partial_not_allowed' } }), { status: 422 })));
    await expect(startPayAttempt('abc', 'pay-12345678', 100)).rejects.toMatchObject({ status: 422, code: 'partial_not_allowed' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(fetchPayLink('abc')).rejects.toMatchObject({ status: 429, code: 'too_many_requests' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(fetchPayLink('abc')).rejects.toEqual(expect.any(PayLinkError));
    await expect(fetchPayLink('abc')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
  it('sends the idempotency key and the amount only when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { checkout_url: 'https://x.test' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await startPayAttempt('abc', 'pay-12345678');
    await startPayAttempt('abc', 'pay-12345678', 5000);
    expect(fetchMock.mock.calls[0][1].body).toBe('{}');
    expect(fetchMock.mock.calls[1][1].body).toBe('{"amount_minor":5000}');
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('pay-12345678');
  });
});
