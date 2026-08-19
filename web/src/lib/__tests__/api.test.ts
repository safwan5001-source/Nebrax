import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

const successResponse = () => new Response(JSON.stringify({ data: {} }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('api JSON bodies', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('يسلسل حمولة الحساب البنكي مرة واحدة ويحفظ حقل النوع', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    const payload = { type: 'bank', name: 'بنك الجزيرة', currency: 'SAR' };
    await api('/cash-bank-accounts', { method: 'POST', body: payload });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(JSON.stringify(payload));
    expect(JSON.parse(request.body as string)).toMatchObject({ type: 'bank', name: 'بنك الجزيرة' });
  });

  it('لا يعيد تسلسل نص JSON الذي يمرره مستهلك قديم للعميل', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    const serialized = JSON.stringify({ type: 'cash', name: 'الخزينة الرئيسية' });
    await api('/cash-bank-accounts', { method: 'POST', body: serialized });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(serialized);
  });
});
