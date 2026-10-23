// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, fetchPrivateFileUrl } from '../api';

const successResponse = () => new Response(JSON.stringify({ data: {} }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const errorResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
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

describe('api error message extraction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('يستخرج الرسالة الآمنة المتداخلة تحت data.message (استجابة إعادة محاولة مركز المستندات)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(422, {
      data: { accepted: false, code: 'document_retry_limit_reached', message: 'تم بلوغ الحد الآمن لعدد مرات إعادة المحاولة اليدوية لهذه المعالجة.' },
    })));

    await expect(api('/document-processing-runs/run-1/retry', { method: 'POST' })).rejects.toMatchObject({
      message: 'تم بلوغ الحد الآمن لعدد مرات إعادة المحاولة اليدوية لهذه المعالجة.',
    });
  });

  it('يفضّل رسالة الجذر عند وجودها (توافق مع نقاط أخرى لا تُغلّف الرسالة)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(422, { message: 'رسالة تحقق مباشرة.' })));

    await expect(api('/some-endpoint', { method: 'POST' })).rejects.toMatchObject({ message: 'رسالة تحقق مباشرة.' });
  });

  it('يسقط إلى رسالة عامة حين لا توجد رسالة جذرية ولا متداخلة', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500, {})));

    await expect(api('/some-endpoint')).rejects.toMatchObject({ message: 'حدث خطأ' });
  });

  it('يحفظ الجسم كاملاً في ApiError.body لأي استهلاك إضافي لاحق', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(422, {
      data: { accepted: false, code: 'document_retry_limit_reached', message: 'محظور.' },
    })));

    try {
      await api('/document-processing-runs/run-1/retry', { method: 'POST' });
      throw new Error('expected ApiError to be thrown');
    } catch (exception) {
      expect(exception).toBeInstanceOf(ApiError);
      expect((exception as ApiError).status).toBe(422);
      expect(((exception as ApiError).body as { data: { code: string } }).data.code).toBe('document_retry_limit_reached');
    }
  });
});

describe('private document preview transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends the existing Bearer token and branch context to the signed document URL', async () => {
    localStorage.setItem('token', 'tenant-token');
    localStorage.setItem('nibras_active_branch', 'branch-a');
    const fetchMock = vi.fn().mockResolvedValue(new Response('%PDF-1.7', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:private-pdf'), revokeObjectURL: vi.fn() });

    await expect(fetchPrivateFileUrl('https://api.example.test/api/document-files/f1/download?signature=signed', 'application/pdf'))
      .resolves.toBe('blob:private-pdf');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/document-files/f1/download?signature=signed',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/pdf',
          Authorization: 'Bearer tenant-token',
          'X-Branch-Id': 'branch-a',
        }),
      }),
    );
  });

  it('rejects a JSON success response instead of handing it to the PDF viewer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Unauthenticated.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(fetchPrivateFileUrl('/document-files/f1/download?signature=signed', 'application/pdf'))
      .rejects.toMatchObject({ status: 502, message: 'preview_invalid_response' });
  });
});
