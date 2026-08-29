import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeBatch, createBatch, runIntake, uploadFile } from './document-intake';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

describe('document-intake', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('ينشئ حزمة عبر POST /document-batches', async () => {
    api.mockResolvedValueOnce({
      data: { id: 'batch-1', document_type: 'expense', status: 'draft' },
    });

    const batch = await createBatch('expense');
    expect(batch.id).toBe('batch-1');
    expect(api).toHaveBeenCalledWith('/document-batches', {
      method: 'POST',
      body: { document_type: 'expense' },
    });
  });

  it('يرفع ملفاً عبر FormData', async () => {
    api.mockResolvedValueOnce({ data: { id: 'file-1', original_name: 'a.pdf' } });
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });

    const uploaded = await uploadFile('batch-1', file);
    expect(uploaded.id).toBe('file-1');
    const [, options] = api.mock.calls[0];
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get('file')).toBe(file);
  });

  it('يكمل الحزمة بعد رفع جميع الملفات تسلسلياً', async () => {
    const progress = vi.fn();
    api
      .mockResolvedValueOnce({ data: { id: 'batch-2', status: 'draft' } })
      .mockResolvedValueOnce({ data: { id: 'f1' } })
      .mockResolvedValueOnce({ data: { id: 'f2' } })
      .mockResolvedValueOnce({ data: { id: 'batch-2', status: 'received' } });

    const files = [
      new File(['a'], 'one.pdf', { type: 'application/pdf' }),
      new File(['b'], 'two.png', { type: 'image/png' }),
    ];

    const result = await runIntake({ documentType: 'purchase_invoice', files, onProgress: progress });
    expect(result.status).toBe('received');
    expect(api).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'creating' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'uploading', currentFile: 2 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'completing' }));
  });

  it('يكمل الحزمة عبر POST .../complete', async () => {
    api.mockResolvedValueOnce({ data: { id: 'batch-3', status: 'received' } });
    const batch = await completeBatch('batch-3');
    expect(batch.status).toBe('received');
    expect(api).toHaveBeenCalledWith('/document-batches/batch-3/complete', {
      method: 'POST',
      body: {},
    });
  });
});
