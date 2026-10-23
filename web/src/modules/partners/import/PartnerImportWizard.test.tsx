// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerImportWizard } from './PartnerImportWizard';

const { api, translate, toastSuccess } = vi.hoisted(() => ({
  api: vi.fn(),
  toastSuccess: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), success: toastSuccess, error: vi.fn() }) }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : iconStub),
    has: () => true,
  });
});

const inspection = {
  columns: [
    { index: 0, header: 'الكود', samples: ['C-1'], suggested_field: 'code' },
    { index: 1, header: 'الاسم', samples: ['شركة'], suggested_field: 'name' },
    { index: 2, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 2,
  fields: [
    { key: 'nebrax_id', label_ar: 'معرّف', label_en: 'ID', type: 'identifier', required: false, clearable: false, update_locked: true, writable: false },
    { key: 'code', label_ar: 'الكود', label_en: 'Code', type: 'text', required: false, clearable: false, update_locked: false, writable: true },
    { key: 'name', label_ar: 'الاسم', label_en: 'Name', type: 'text', required: true, clearable: false, update_locked: false, writable: true },
  ],
};

const cleanPreview = {
  type: 'supplier', total_rows: 2, create_rows: 2, update_rows: 0, skipped_rows: 0, warning_rows: 0, error_rows: 0,
  rows: [], rows_shown: 0, rows_truncated: false, errors: [], binding: { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' },
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'partner_master', status: 'ready', original_filename: 'p.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 2, column_count: 3, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'p.csv', { type: 'text/csv' });

beforeEach(() => {
  window.history.replaceState({}, '', '/suppliers/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/partners/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/partners/import/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});
afterEach(cleanup);

describe('PartnerImportWizard (IMP-H3-S3)', () => {
  it('inspects the file, shows the mapping and sends the entry-point type with the preview', async () => {
    const user = userEvent.setup();
    render(<PartnerImportWizard type="supplier" />);

    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());
    expect((screen.getByLabelText('عمود غريب') as HTMLSelectElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const inspectForm = api.mock.calls.find((call) => call[0] === '/partners/import/inspect')?.[1]?.body as FormData;
    expect(inspectForm.get('type')).toBe('supplier');
    const form = api.mock.calls.find((call) => call[0] === '/partners/import/preview')?.[1]?.body as FormData;
    expect([form.get('type'), form.get('mapping[0]'), form.get('mapping[1]'), form.get('mapping[2]')]).toEqual(['supplier', 'code', 'name', 'ignore']);
  });

  it('blocks the preview when a required field is unmapped and for update when no identifier is mapped', async () => {
    const user = userEvent.setup();
    render(<PartnerImportWizard type="customer" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());

    await user.selectOptions(screen.getByLabelText('الاسم'), '');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/mapping_missing_required/)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('الاسم'), 'name');
    await user.selectOptions(screen.getByLabelText('mode'), 'update');
    await user.selectOptions(screen.getByLabelText('الكود'), '');
    expect(screen.getByText('mapping_missing_identifier')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('applies through a preview-bound durable job without re-sending semantic options', async () => {
    const user = userEvent.setup();
    render(<PartnerImportWizard type="supplier" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 2, apply_result: { created: 2, updated: 0, skipped: 0 } }) });
      }
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[type]'), create.get('options[mode]')]).toEqual(['partner_master', 'pv-1', 'supplier', 'create']);
    const apply = api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body as Record<string, unknown>;
    expect(apply).toEqual({});
  });

  it('refuses to apply a preview with errors and offers the error report', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/partners/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/partners/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, create_rows: 1, error_rows: 1, errors: [{ row: 3, messages: ['bad email'] }] } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<PartnerImportWizard type="customer" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('row_label:3: bad email')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'download_errors' })).toBeTruthy();
  });
});
