import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

import { createImportJob } from './client';

function sentForm(): FormData {
  const call = api.mock.calls.at(-1);
  return call?.[1].body as FormData;
}

describe('createImportJob (IMP-H1-S3b)', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue({ data: { id: 'job-1' } });
  });

  it('sends only domain and file when there is no preview binding (legacy contract)', async () => {
    await createImportJob('product_catalog', new File(['a'], 'a.csv'));

    const form = sentForm();
    expect([...form.keys()].sort()).toEqual(['domain', 'file']);
  });

  it('attaches the preview id/hash and the frozen options as nested multipart fields', async () => {
    await createImportJob('product_catalog', new File(['a'], 'a.csv'), 'idem-1', null, {
      binding: { id: 'prev-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' },
      options: {
        mode: 'create',
        mapping: { 0: 'sku', 1: null },
        apply_product_images: false,
        approve_existing_media_updates: true,
        notes: undefined,
      },
    });

    const form = sentForm();
    expect(form.get('preview_id')).toBe('prev-1');
    expect(form.get('preview_hash')).toBe('h'.repeat(64));
    expect(form.get('idempotency_key')).toBe('idem-1');
    expect(form.get('options[mode]')).toBe('create');
    // العمود المتجاهَل يُرسَل `ignore` صراحةً كما في المعاينة والتطبيق.
    expect(form.get('options[mapping][0]')).toBe('sku');
    expect(form.get('options[mapping][1]')).toBe('ignore');
    expect(form.get('options[apply_product_images]')).toBe('0');
    expect(form.get('options[approve_existing_media_updates]')).toBe('1');
    expect(form.has('options[notes]')).toBe(false);
  });
});
