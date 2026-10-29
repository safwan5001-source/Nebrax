// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockPermitImportWizard } from './StockPermitImportWizard';

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

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const field = (key: string, ar: string, required = false) => ({ key, label_ar: ar, label_en: key, type: 'text', required });
const inspection = {
  columns: [
    { index: 0, header: 'رمز الصنف', samples: ['SKU-A'], suggested_field: 'sku' },
    { index: 1, header: 'الكمية', samples: ['5'], suggested_field: 'quantity' },
    { index: 2, header: 'التكلفة', samples: ['12.50'], suggested_field: 'unit_cost' },
  ],
  total_rows: 2,
  fields: [field('product_id', 'معرّف'), field('sku', 'الرمز'), field('barcode', 'الباركود'), field('quantity', 'كمية', true), field('unit', 'الوحدة'), field('unit_cost', 'تكلفة')],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const previewRow = { row: 2, action: 'line', status: 'ok', valid: true, sku: 'SKU-A', barcode: null, product_name: 'صنف أ', quantity: 5, unit: null, unit_cost: 1250, line_cost: 6250, messages: [], warnings: [] };
const cleanPreview = {
  permit_type: 'receipt', permit_date: '2026-03-10', warehouse_id: W1, warehouse_name: 'الرئيسي', target_warehouse_id: null, target_warehouse_name: null, allow_zero_cost: false,
  total_rows: 1, line_rows: 1, warning_rows: 0, error_rows: 0, valid_rows: 1, invalid_rows: 0, total_cost: 6250, rows: [previewRow], rows_shown: 1, rows_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'stock_permit_import', status: 'ready', original_filename: 'p.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 1, column_count: 3, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'p.csv', { type: 'text/csv' });
const formOf = (path: string) => api.mock.calls.filter((call) => call[0] === path).at(-1)?.[1]?.body as FormData;

function defaultApi(path: string) {
  if (path === '/warehouses') return Promise.resolve({ data: [{ id: W1, name: 'الرئيسي', code: 'WH-1', is_active: true }, { id: W2, name: 'الفرع', code: 'WH-2', is_active: true }, { id: 'w3', name: 'معطّل', is_active: false }] });
  if (path === '/stock-permits/import/inspect') return Promise.resolve({ data: inspection });
  if (path === '/stock-permits/import/preview') return Promise.resolve({ data: cleanPreview });
  return Promise.resolve({ data: {} });
}

async function chooseHeader(user: ReturnType<typeof userEvent.setup>, type = 'receipt') {
  await waitFor(() => expect(screen.getByRole('option', { name: 'WH-1 — الرئيسي' })).toBeTruthy());
  await user.selectOptions(screen.getByLabelText('permit_type'), type);
  await user.selectOptions(screen.getByLabelText(type === 'transfer' ? 'from_warehouse' : 'warehouse'), W1);
}

async function reachPreview(user: ReturnType<typeof userEvent.setup>) {
  await chooseHeader(user);
  await user.upload(screen.getByLabelText('step_file'), csv());
  await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
}

beforeEach(() => {
  window.history.replaceState({}, '', '/stock-permits/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation(defaultApi);
});
afterEach(cleanup);

describe('StockPermitImportWizard (IMP-H7-S3b)', () => {
  it('lists only active warehouses and blocks the file until the header is complete', async () => {
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'WH-1 — الرئيسي' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: 'معطّل' })).toBeNull();
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('permit_type'), 'transfer');
    await user.selectOptions(screen.getByLabelText('from_warehouse'), W1);
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('to_warehouse'), W1);
    expect(screen.getByText('same_warehouse')).toBeTruthy();
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('to_warehouse'), W2);
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(false);
  });

  it('sends the header with inspect and preview, then freezes the PREVIEW-resolved date into a bound job', async () => {
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user);
    await user.type(screen.getByLabelText('reason'), 'جرد أولي');
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    const inspectForm = formOf('/stock-permits/import/inspect');
    expect([inspectForm.get('permit_type'), inspectForm.get('warehouse_id')]).toEqual(['receipt', W1]);

    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const previewForm = formOf('/stock-permits/import/preview');
    // التاريخ الفارغ لا يُرسَل؛ الخادم يحسمه
    expect([previewForm.get('permit_type'), previewForm.get('warehouse_id'), previewForm.get('reason'), previewForm.get('permit_date'), previewForm.get('mapping[2]')]).toEqual(['receipt', W1, 'جرد أولي', null, 'unit_cost']);
    expect(screen.getByText('2026-03-10')).toBeTruthy();

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 1, apply_result: { permit_id: 'perm-9', permit_number: 'SP-0009', lines: 1 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('SP-0009')).toBeTruthy());
    const create = formOf('/import-jobs');
    expect([create.get('domain'), create.get('preview_id'), create.get('options[permit_type]'), create.get('options[warehouse_id]'), create.get('options[permit_date]'), create.get('options[reason]'), create.get('options[mapping][2]')])
      .toEqual(['stock_permit_import', 'pv-1', 'receipt', W1, '2026-03-10', 'جرد أولي', 'unit_cost']);
    expect(create.get('idempotency_key')).toBe('stock-permit-pv-1');
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
    expect(screen.getByText('result_draft_hint')).toBeTruthy();
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === '/stock-permits/perm-9')).toBe(true);
  });

  it('ignores the cost column for an issue automatically and rejects it if re-mapped', async () => {
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user, 'issue');
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('التكلفة')).toBeTruthy());
    expect((screen.getByLabelText('التكلفة') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('التكلفة'), 'unit_cost');
    expect(screen.getByText('mapping_cost_receipt_only')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('drops the mapped cost column when the type changes to a non-receipt, and requires explicit zero-cost for a receipt without cost', async () => {
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('التكلفة')).toBeTruthy());
    expect((screen.getByLabelText('التكلفة') as HTMLSelectElement).value).toBe('unit_cost');

    await user.selectOptions(screen.getByLabelText('permit_type'), 'transfer');
    expect((screen.getByLabelText('التكلفة') as HTMLSelectElement).value).toBe('');
    await user.selectOptions(screen.getByLabelText('permit_type'), 'receipt');
    await user.selectOptions(screen.getByLabelText('التكلفة'), '');
    expect(screen.getByText('mapping_missing_cost')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('switch'));
    expect(screen.queryByText('mapping_missing_cost')).toBeNull();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('adapts a late inspection response to the CURRENT type (no cost column re-bound after a type change)', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.mockImplementation((path: string) => {
      if (path === '/stock-permits/import/inspect') return new Promise((resolve) => { release = resolve; });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(api.mock.calls.some((call) => call[0] === '/stock-permits/import/inspect')).toBe(true));
    await user.selectOptions(screen.getByLabelText('permit_type'), 'issue');
    release({ data: inspection });

    await waitFor(() => expect(screen.getByLabelText('التكلفة')).toBeTruthy());
    expect((screen.getByLabelText('التكلفة') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('mapping_cost_receipt_only')).toBeNull();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses to apply a preview with errors and offers the error report', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/stock-permits/import/preview') return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, line_rows: 0, errors: [{ row: 3, messages: ['bad qty'] }], rows: [{ ...previewRow, valid: false, action: 'error', messages: ['bad qty'] }] } });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('row_label:3: bad qty')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'download_errors' })).toBeTruthy();
  });

  it('shows costs only on a receipt preview', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/stock-permits/import/preview') return Promise.resolve({ data: { ...cleanPreview, permit_type: 'issue', total_cost: 0, rows: [{ ...previewRow, unit_cost: null, line_cost: null }] } });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await chooseHeader(user, 'issue');
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('رمز الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    expect(screen.queryByText('col_unit_cost')).toBeNull();
    expect(screen.queryByText('count_total_cost')).toBeNull();
  });

  it('a header changed after a preview is what the next preview and the job freeze', async () => {
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await reachPreview(user);
    await user.click(screen.getByRole('button', { name: 'back_to_setup' }));
    await user.type(screen.getByLabelText('reason'), 'سبب جديد');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    expect(formOf('/stock-permits/import/preview').get('reason')).toBe('سبب جديد');

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      return Promise.resolve({ data: jobFixture({ status: 'completed', apply_result: { permit_id: 'p', permit_number: 'SP-2', lines: 1 } }) });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByText('SP-2')).toBeTruthy());
    expect(formOf('/import-jobs').get('options[reason]')).toBe('سبب جديد');
  });

  it('shows a job-creation failure and returns to the preview', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await reachPreview(user);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.reject(new ApiError(422, 'المعاينة منتهية', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('المعاينة منتهية'));
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
  });

  it('refuses a resumed job of another domain or one that is not preview-bound', async () => {
    for (const [domain, bound, expectedText] of [['expense_import', true, 'resumed_wrong_domain'], ['stock_permit_import', false, 'resumed_unbound']] as const) {
      cleanup();
      window.history.replaceState({}, '', '/stock-permits/import?job=job-9');
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', domain, preview_bound: bound }) });
        return defaultApi(path);
      });
      render(<StockPermitImportWizard />);
      await waitFor(() => expect(screen.getByText(expectedText)).toBeTruthy());
      expect(screen.queryByRole('button', { name: 'apply' }) === null || (screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
      expect(api.mock.calls.some((call) => String(call[0]).endsWith('/apply'))).toBe(false);
    }
  });

  it('continues a bound job that stopped midway without sending page options', async () => {
    window.history.replaceState({}, '', '/stock-permits/import?job=job-9');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'ready' }) });
      if (path === '/import-jobs/job-9/apply') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'completed', apply_result: { permit_id: 'p', permit_number: 'SP-1', lines: 2 } }) });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<StockPermitImportWizard />);
    await waitFor(() => expect(screen.getByText('resumed_title')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByText('SP-1')).toBeTruthy());
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-9/apply')?.[1]?.body).toEqual({});
  });
});
