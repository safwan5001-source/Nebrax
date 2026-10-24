import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, downloadFile } = vi.hoisted(() => ({ api: vi.fn(), downloadFile: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, downloadFile, ApiError: class ApiError extends Error {} }));

import { applyImportJobChunk, createImportJob, createRepairJob, downloadImportFailures, hasFrozenOptions } from './client';

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
  it('sends a list option as repeated options[key][] fields and skips an empty one (IMP-H5-S2b)', async () => {
    await createImportJob('expense_import', new File(['a'], 'a.csv'), undefined, null, {
      binding: { id: 'prev-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' },
      options: { confirmed_repeat_rows: [3, 5], default_tax_rate: 15 },
    });
    const form = sentForm();
    expect(form.getAll('options[confirmed_repeat_rows][]')).toEqual(['3', '5']);
    expect(form.get('options[default_tax_rate]')).toBe('15');

    await createImportJob('expense_import', new File(['a'], 'a.csv'), undefined, null, {
      binding: { id: 'prev-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' },
      options: { confirmed_repeat_rows: [] },
    });
    expect(sentForm().has('options[confirmed_repeat_rows][]')).toBe(false);
  });

  it('omits an empty mapping so the frozen options match the preview, which cannot send one', async () => {
    await createImportJob('product_catalog', new File(['a'], 'a.csv'), undefined, null, {
      binding: { id: 'prev-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' },
      options: { mode: 'create', mapping: {} },
    });

    const keys = [...sentForm().keys()];
    expect(keys.some((key) => key.startsWith('options[mapping]'))).toBe(false);
  });
});

describe('applyImportJobChunk (IMP-H1-S3b)', () => {
  it('does not send an empty mapping at apply either', async () => {
    api.mockReset();
    api.mockResolvedValue({ data: { id: 'job-1' } });

    await applyImportJobChunk('job-1', { mode: 'create', mapping: {} });

    expect(api.mock.calls.at(-1)?.[1].body).toEqual({ mode: 'create' });
  });
});

describe('repair client (IMP-H1-S8b/c)', () => {
  it('creates a child job from the corrected file against the parent id, with no domain or options of its own', async () => {
    api.mockReset();
    api.mockResolvedValue({ data: { id: 'child-1', parent_job_id: 'parent-1' } });

    const child = await createRepairJob('parent-1', new File(['x'], 'fixed.xlsx'), 'idem-r');

    const [path, init] = api.mock.calls.at(-1)!;
    expect(path).toBe('/import-jobs/parent-1/repairs');
    expect(init.method).toBe('POST');
    expect([...(init.body as FormData).keys()].sort()).toEqual(['file', 'idempotency_key']);
    expect(child.parent_job_id).toBe('parent-1');
  });

  it('downloads the failures file as XLSX (CSV would corrupt values on re-upload)', async () => {
    downloadFile.mockResolvedValue('downloaded');

    await downloadImportFailures('job-9');

    expect(downloadFile).toHaveBeenCalledWith('/import-jobs/job-9/failures?format=xlsx', 'failures.xlsx');
  });
});

describe('hasFrozenOptions (IMP-WIZARD-STATE-01b)', () => {
  it('treats a preview-bound job and a repair child as frozen, and a plain legacy job as not', () => {
    expect(hasFrozenOptions({ preview_bound: true })).toBe(true);
    expect(hasFrozenOptions({ preview_bound: false, parent_job_id: 'job-0' })).toBe(true);
    expect(hasFrozenOptions({ preview_bound: false, parent_job_id: null })).toBe(false);
    expect(hasFrozenOptions({})).toBe(false);
  });
});
