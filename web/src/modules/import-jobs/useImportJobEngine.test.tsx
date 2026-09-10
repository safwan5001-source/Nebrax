// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImportJobEngine } from './useImportJobEngine';
import { ApiError } from '@/lib/api';

const { createImportJob, getImportJob, applyImportJobChunk, cancelImportJob } = vi.hoisted(() => ({
  createImportJob: vi.fn(),
  getImportJob: vi.fn(),
  applyImportJobChunk: vi.fn(),
  cancelImportJob: vi.fn(),
}));

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, createImportJob, getImportJob, applyImportJobChunk, cancelImportJob };
});

function job(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    domain: 'product_catalog',
    status: 'ready',
    original_filename: 'catalog.csv',
    extension: 'csv',
    byte_size: 100,
    content_sha256: 'abc',
    row_count: 3,
    column_count: 4,
    processed_rows: 0,
    apply_result: null,
    error_message: null,
    created_by: null,
    cancelled_by: null,
    cancelled_at: null,
    purge_after: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useImportJobEngine', () => {
  it('upload creates a job and retains its identity', async () => {
    createImportJob.mockResolvedValue(job());
    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.upload(new File(['x'], 'catalog.csv'));
    });

    expect(result.current.job?.id).toBe('job-1');
    expect(result.current.job?.status).toBe('ready');
  });

  it('resumes an existing job by id from the authoritative backend state', async () => {
    getImportJob.mockResolvedValue(job({ status: 'processing', processed_rows: 1 }));
    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.resume('job-1');
    });

    expect(getImportJob).toHaveBeenCalledWith('job-1');
    expect(result.current.job?.status).toBe('processing');
  });

  it('drives a chunked apply loop using the server-owned cursor until completed', async () => {
    applyImportJobChunk
      .mockResolvedValueOnce(job({ status: 'processing', processed_rows: 1, row_count: 3 }))
      .mockResolvedValueOnce(job({ status: 'processing', processed_rows: 2, row_count: 3 }))
      .mockResolvedValueOnce(job({ status: 'completed', processed_rows: 3, row_count: 3 }));

    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.applyLoop('job-1', { mode: 'create' });
    });

    expect(applyImportJobChunk).toHaveBeenCalledTimes(3);
    // كل استدعاءٍ يمرّر نفس الخيارات — لا مؤشّراً يحسبه العميل؛ الخادم وحده
    // يقرر القطعة التالية عبر `processed_rows` المخزَّن لديه.
    for (const call of applyImportJobChunk.mock.calls) {
      expect(call[0]).toBe('job-1');
    }
    expect(result.current.job?.status).toBe('completed');
    expect(result.current.job?.processed_rows).toBe(3);
  });

  it('ignores a second concurrent call while one is already in flight (duplicate-click protection)', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    applyImportJobChunk.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );

    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    let firstDone = false;
    act(() => {
      void result.current.applyLoop('job-1', {}).then(() => { firstDone = true; });
    });
    await act(async () => {
      await result.current.applyLoop('job-1', {}); // يجب أن يُتجاهَل فوراً بلا نداء API
    });

    expect(applyImportJobChunk).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(job({ status: 'completed', processed_rows: 3, row_count: 3 }));
      await waitFor(() => expect(firstDone).toBe(true));
    });
  });

  it('does not treat a network interruption as a failure — it re-fetches authoritative state instead', async () => {
    applyImportJobChunk
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(job({ status: 'completed', processed_rows: 3, row_count: 3 }));
    getImportJob.mockResolvedValueOnce(job({ status: 'processing', processed_rows: 0, row_count: 3 }));

    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.applyLoop('job-1', {});
    });

    // أُعيد الجلب مرّةً لمعرفة الحالة الحقيقية، ثم استؤنف التطبيق بأمان —
    // لا رسالة فشلٍ لمجرّد انقطاع شبكة.
    expect(getImportJob).toHaveBeenCalledWith('job-1');
    expect(result.current.error).toBeNull();
    expect(result.current.job?.status).toBe('completed');
  });

  it('surfaces an explicit backend rejection (e.g. 422) as an actionable error, not a generic failure', async () => {
    applyImportJobChunk.mockRejectedValueOnce(new ApiError(422, 'قائمة السعر المحدَّدة غير موجودة في نطاق المؤسسة.', {}));
    getImportJob.mockResolvedValueOnce(job({ status: 'failed', error_message: 'قائمة السعر المحدَّدة غير موجودة في نطاق المؤسسة.' }));

    const { result } = renderHook(() => useImportJobEngine('product_workbook'));

    await act(async () => {
      await result.current.applyLoop('job-1', { price_list_id: null });
    });

    expect(result.current.error).toBe('قائمة السعر المحدَّدة غير موجودة في نطاق المؤسسة.');
    expect(result.current.job?.status).toBe('failed');
  });

  it('cancel transitions the job to cancelled via the authoritative backend response', async () => {
    cancelImportJob.mockResolvedValue(job({ status: 'cancelled' }));
    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.cancel('job-1');
    });

    expect(result.current.job?.status).toBe('cancelled');
    expect(result.current.isTerminal).toBe(true);
  });

  it('retrying apply on an already-completed job is presented identically (idempotent)', async () => {
    applyImportJobChunk.mockResolvedValue(job({ status: 'completed', processed_rows: 3, row_count: 3 }));
    const { result } = renderHook(() => useImportJobEngine('product_catalog'));

    await act(async () => {
      await result.current.applyLoop('job-1', {});
    });
    await act(async () => {
      await result.current.applyLoop('job-1', {});
    });

    expect(result.current.job?.status).toBe('completed');
    expect(result.current.canApply).toBe(false);
  });
});
