// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StocktakeCountImportWizard } from './StocktakeCountImportWizard';

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

const field = (key: string, ar: string, required = false) => ({ key, label_ar: ar, label_en: key, type: 'text', required });
const inspection = {
  columns: [
    { index: 0, header: 'رمز الصنف', samples: ['SKU-A'], suggested_field: 'sku' },
    { index: 1, header: 'الكمية المعدودة', samples: ['9'], suggested_field: 'counted_quantity' },
    { index: 2, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 2,
  fields: [field('nebrax_id', 'معرّف'), field('sku', 'الرمز'), field('barcode', 'الباركود'), field('product_name', 'الاسم'), field('counted_quantity', 'الكمية', true)],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const cleanPreview = {
  stocktake_id: 'st-1', stocktake_number: 'CNT-1', existing_count_policy: 'error', total_rows: 2, sheet_lines: 3, to_write: 2, unchanged_rows: 0, skipped_rows: 0,
  overwrite_rows: 0, error_rows: 0, uncounted_after: 1, rows: [], rows_shown: 0, rows_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'stocktake_count', status: 'ready', original_filename: 's.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 2, column_count: 3, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 's.csv', { type: 'text/csv' });

beforeEach(() => {
  window.history.replaceState({}, '', '/stocktaking/st-1/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/stocktakes/count-import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/stocktakes/count-import/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});
afterEach(cleanup);

describe('StocktakeCountImportWizard (IMP-H7-S1c)', () => {
  it('sends the target stocktake and the policy with inspect and preview, and links back to that stocktake', async () => {
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/stocktaking/st-1')).toBe(true);

    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    expect((screen.getByLabelText('عمود غريب') as HTMLSelectElement).value).toBe('');
    await user.selectOptions(screen.getByLabelText('existing_policy'), 'overwrite');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const inspectForm = api.mock.calls.find((call) => call[0] === '/stocktakes/count-import/inspect')?.[1]?.body as FormData;
    expect(inspectForm.get('stocktake_id')).toBe('st-1');
    const form = api.mock.calls.find((call) => call[0] === '/stocktakes/count-import/preview')?.[1]?.body as FormData;
    expect([form.get('stocktake_id'), form.get('existing_count_policy'), form.get('mapping[2]')]).toEqual(['st-1', 'overwrite', 'ignore']);
    expect(screen.getByText('uncounted_note:1')).toBeTruthy();
  });

  it('blocks the preview without a product identifier or the quantity column', async () => {
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());

    await user.selectOptions(screen.getByLabelText('رمز الصنف'), '');
    expect(screen.getByText('mapping_missing_identifier')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('رمز الصنف'), 'product_name');
    expect(screen.getByText('mapping_missing_identifier')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('رمز الصنف'), 'barcode');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('الكمية المعدودة'), '');
    expect(screen.getByText('mapping_missing_quantity')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('applies through a preview-bound atomic job freezing the target and policy, and shows that nothing was posted', async () => {
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 2, apply_result: { written: 2, overwritten: 0, unchanged: 0, skipped: 0 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_written')).toBeTruthy());
    expect(screen.getByText('result_not_posted_hint')).toBeTruthy();
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[stocktake_id]'), create.get('options[existing_count_policy]'), create.get('options[mapping][2]')]).toEqual(['stocktake_count', 'pv-1', 'st-1', 'error', 'ignore']);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
    // مفتاح ثباتٍ مشتق من المعاينة أحادية الاستعمال كي لا تتحول إعادة المحاولة بعد انقطاعٍ إلى تشغيلةٍ ثانية
    expect(create.get('idempotency_key')).toBe('stocktake-count-pv-1');
  });

  it('refuses to apply a preview with errors and offers the error report', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/stocktakes/count-import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/stocktakes/count-import/preview') return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['bad qty'] }] } });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('row_label:3: bad qty')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'download_errors' })).toBeTruthy();
  });

  it('shows a job-creation failure and returns to the preview, and never re-applies a stale job after a rule change', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.reject(new ApiError(422, 'المعاينة منتهية', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('المعاينة منتهية'));
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();

    let creates = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/stocktakes/count-import/preview') return Promise.resolve({ data: cleanPreview });
      if (path === '/import-jobs' && options?.method === 'POST') { creates += 1; return Promise.resolve({ data: jobFixture({ id: `job-${creates}` }) }); }
      if (path.startsWith('/import-jobs/job-')) return Promise.reject(new ApiError(500, 'تعذّر', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(creates).toBe(1));
    await user.click(screen.getByRole('button', { name: 'step_setup' }));
    await user.selectOptions(screen.getByLabelText('existing_policy'), 'skip');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(creates).toBe(2));
    const second = api.mock.calls.filter((call) => call[0] === '/import-jobs' && call[1]?.method === 'POST').at(-1)?.[1]?.body as FormData;
    expect(second.get('options[existing_count_policy]')).toBe('skip');
  });

  it('applies a resumed job only when it is a stocktake_count job frozen to THIS stocktake', async () => {
    for (const [target, domain, enabled] of [['st-2', 'stocktake_count', false], ['st-1', 'expense_import', false], ['st-1', 'stocktake_count', true]] as const) {
      cleanup();
      window.history.replaceState({}, '', '/stocktaking/st-1/import?job=job-9');
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', domain, target_id: target }) });
        return Promise.resolve({ data: {} });
      });
      render(<StocktakeCountImportWizard stocktakeId="st-1" />);

      await waitFor(() => expect(screen.getByText('resumed_title')).toBeTruthy());
      expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled, `${domain}/${target}`).toBe(!enabled);
      expect(Boolean(screen.queryByText('resumed_other_target'))).toBe(!enabled);
    }
  });

  it('cannot navigate back while the job is being applied', async () => {
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    let release: (value: unknown) => void = () => {};
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByText('step_apply', { selector: '[class*="font"]' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'step_setup' }));
    expect(screen.queryByLabelText('existing_policy')).toBeNull();
    expect(screen.getByText('step_apply', { selector: '[class*="font"]' })).toBeTruthy();
    release({ data: jobFixture({ status: 'completed', apply_result: { written: 2 } }) });
  });

  it('offers a continue action for a resumed processing job of this stocktake', async () => {
    window.history.replaceState({}, '', '/stocktaking/st-1/import?job=job-7');
    let applied = 0;
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', status: 'processing', target_id: 'st-1' }) });
      if (path === '/import-jobs/job-7/apply') { applied += 1; return Promise.resolve({ data: jobFixture({ id: 'job-7', status: 'completed', target_id: 'st-1', apply_result: { written: 2 } }) }); }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'continue_apply' })).toBeTruthy());
    expect(applied).toBe(0);
    await user.click(screen.getByRole('button', { name: 'continue_apply' }));
    await waitFor(() => expect(screen.getByText('result_written')).toBeTruthy());
    expect(applied).toBe(1);
  });

  it('offers no continue action for a processing job that belongs to another stocktake', async () => {
    window.history.replaceState({}, '', '/stocktaking/st-1/import?job=job-8');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-8') return Promise.resolve({ data: jobFixture({ id: 'job-8', status: 'processing', target_id: 'st-2' }) });
      return Promise.resolve({ data: {} });
    });
    render(<StocktakeCountImportWizard stocktakeId="st-1" />);

    await waitFor(() => expect(screen.getByText('step_apply', { selector: '[class*="font"]' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'continue_apply' })).toBeNull();
  });
});
