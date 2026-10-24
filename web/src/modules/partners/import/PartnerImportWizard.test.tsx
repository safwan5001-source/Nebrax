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

  describe('IMP-WIZARD-STATE-01b', () => {
    async function previewReady(user: ReturnType<typeof userEvent.setup>) {
      render(<PartnerImportWizard type="supplier" />);
      await user.upload(screen.getByLabelText('step_file'), csv());
      await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'run_preview' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    }

    it('never shows or continues a job of another domain opened from the URL, in any status', async () => {
      for (const status of ['ready', 'processing']) {
        window.history.replaceState({}, '', '/suppliers/import?job=job-7');
        api.mockReset();
        api.mockImplementation((path: string) => {
          if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', domain: 'product_taxonomy', status, preview_bound: true }) });
          return Promise.resolve({ data: [] });
        });
        const { unmount } = render(<PartnerImportWizard type="supplier" />);

        await waitFor(() => expect(screen.getByText('resumed_wrong_domain')).toBeTruthy());
        expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'continue_apply' })).toBeNull();
        expect(api.mock.calls.some((call) => String(call[0]).endsWith('/apply'))).toBe(false);
        unmount();
      }
    });

    it('refuses an unbound job but lets a repair child inherit its frozen options on resume', async () => {
      window.history.replaceState({}, '', '/suppliers/import?job=job-8');
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-8') return Promise.resolve({ data: jobFixture({ id: 'job-8', status: 'ready', preview_bound: false }) });
        return Promise.resolve({ data: [] });
      });
      const unbound = render(<PartnerImportWizard type="supplier" />);
      await waitFor(() => expect(screen.getByText('resumed_unbound')).toBeTruthy());
      expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
      unbound.unmount();

      for (const status of ['ready', 'processing']) {
        window.history.replaceState({}, '', '/suppliers/import?job=job-r');
        api.mockReset();
        api.mockImplementation((path: string) => {
          if (path === '/import-jobs/job-r') return Promise.resolve({ data: jobFixture({ id: 'job-r', status, preview_bound: false, parent_job_id: 'job-0' }) });
          return Promise.resolve({ data: [] });
        });
        const { unmount } = render(<PartnerImportWizard type="supplier" />);
        await waitFor(() => expect(screen.getByRole('button', { name: status === 'ready' ? 'apply' : 'continue_apply' })).toBeTruthy());
        expect(screen.queryByText('resumed_unbound')).toBeNull();
        unmount();
      }
    });

    it('shows a job-creation failure and returns to the preview instead of an empty page', async () => {
      const { ApiError } = await import('@/lib/api');
      const user = userEvent.setup();
      await previewReady(user);

      api.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === '/import-jobs' && options?.method === 'POST') return Promise.reject(new ApiError(422, 'المعاينة منتهية', null));
        return Promise.resolve({ data: {} });
      });
      await user.click(screen.getByRole('button', { name: 'apply' }));

      await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('المعاينة منتهية'));
      expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
    });

    it('disables Apply once the job from this preview has ended, and explains a failure after earlier chunks applied rows', async () => {
      const user = userEvent.setup();
      await previewReady(user);

      api.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
        if (path.startsWith('/import-jobs/job-1')) return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 3, error_message: 'تعذّر' }) });
        return Promise.resolve({ data: {} });
      });
      await user.click(screen.getByRole('button', { name: 'apply' }));
      await waitFor(() => expect(screen.getByText('partial_failure_note:3')).toBeTruthy());
      expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'step_preview' }));
      expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('preview_used')).toBeTruthy();
    });

    it('drops a stale job when a rule changes, so the next apply creates a new job with the new rule', async () => {
      const { ApiError } = await import('@/lib/api');
      const user = userEvent.setup();
      await previewReady(user);

      let creates = 0;
      api.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === '/partners/import/preview') return Promise.resolve({ data: cleanPreview });
        if (path === '/import-jobs' && options?.method === 'POST') { creates += 1; return Promise.resolve({ data: jobFixture({ id: `job-${creates}` }) }); }
        if (path.startsWith('/import-jobs/job-')) return Promise.reject(new ApiError(500, 'تعذّر', null));
        return Promise.resolve({ data: {} });
      });
      await user.click(screen.getByRole('button', { name: 'apply' }));
      await waitFor(() => expect(creates).toBe(1));

      await user.click(screen.getByRole('button', { name: 'step_setup' }));
      await user.selectOptions(screen.getByLabelText('mode'), 'upsert');
      await user.click(screen.getByRole('button', { name: 'run_preview' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'apply' }));

      await waitFor(() => expect(creates).toBe(2));
      const second = api.mock.calls.filter((call) => call[0] === '/import-jobs' && call[1]?.method === 'POST').at(-1)?.[1]?.body as FormData;
      expect(second.get('options[mode]')).toBe('upsert');
    });

    it('does not let the stepper jump to a preview that does not exist, and shows the cumulative total on the result', async () => {
      window.history.replaceState({}, '', '/suppliers/import?job=job-9');
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'failed', processed_rows: 1, error_message: 'تعذّر' }) });
        return Promise.resolve({ data: [] });
      });
      const user = userEvent.setup();
      const failed = render(<PartnerImportWizard type="supplier" />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'step_preview' }));
      expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
      expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();   // بقيت شاشة التنفيذ؛ لا بطاقة فارغة
      failed.unmount();

      window.history.replaceState({}, '', '/suppliers/import?job=job-10');
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-10') return Promise.resolve({ data: jobFixture({ id: 'job-10', status: 'completed', processed_rows: 250, apply_result: { created: 50, updated: 0, skipped: 0 } }) });
        return Promise.resolve({ data: [] });
      });
      render(<PartnerImportWizard type="supplier" />);
      await waitFor(() => expect(screen.getByText('result_processed')).toBeTruthy());
      expect(screen.getByText('result_processed').parentElement?.textContent).toContain('250');
    });
  });
});
