// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseImportWizard } from './PurchaseImportWizard';

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
    { index: 0, header: 'المورّد', samples: ['S-001'], suggested_field: 'supplier_code' },
    { index: 1, header: 'رقم الفاتورة', samples: ['INV-1'], suggested_field: 'supplier_invoice_ref' },
    { index: 2, header: 'التاريخ', samples: ['2026-10-01'], suggested_field: 'purchase_date' },
    { index: 3, header: 'الصنف', samples: ['CEM-50'], suggested_field: 'sku' },
    { index: 4, header: 'الكمية', samples: ['10'], suggested_field: 'quantity' },
    { index: 5, header: 'السعر', samples: ['25.00'], suggested_field: 'unit_price' },
    { index: 6, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 5,
  fields: [
    field('supplier_code', 'المورّد'), field('supplier_invoice_ref', 'رقم الفاتورة', true), field('purchase_date', 'التاريخ', true), field('sku', 'الصنف'),
    field('quantity', 'الكمية', true), field('unit_price', 'السعر', true),
  ],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const unit = (over: Record<string, unknown> = {}) => ({
  row: 2, rows: [2, 3], ordinal: 0, action: 'create', status: 'ok', valid: true, supplier_invoice_ref: 'INV-1', supplier_code: 'S-001', date: '2026-10-01',
  lines: 2, total_minor: 41630, existing_purchase: false, messages: [], warnings: [], ...over,
});
const cleanPreview = {
  total_rows: 5, total_units: 2, create_units: 2, warning_units: 0, error_units: 0, create_total_minor: 80000,
  units: [unit(), unit({ row: 4, rows: [4], ordinal: 1, supplier_invoice_ref: 'INV-2', lines: 1 })], units_shown: 2, units_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'purchase_import', status: 'ready', original_filename: 'p.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 5, column_count: 7, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'p.csv', { type: 'text/csv' });

beforeEach(() => {
  window.history.replaceState({}, '', '/purchases/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/partners?type=supplier') return Promise.resolve({ data: [
      { id: 'sup-1', name: 'مورّد الإسمنت', code: 'S-001', is_active: true },
      { id: 'sup-off', name: 'معطّل', code: 'S-OFF', is_active: false },
    ] });
    if (path === '/warehouses') return Promise.resolve({ data: [
      { id: 'wh-1', name: 'الرئيسي', code: 'W1', is_active: true },
      { id: 'wh-off', name: 'مغلق', code: 'W2', is_active: false },
    ] });
    if (path === '/purchases/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/purchases/import/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});
afterEach(cleanup);

async function previewReady(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('step_file'), csv());
  await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
}

describe('PurchaseImportWizard (IMP-H5-S4b)', () => {
  it('inspects the file, offers only active suppliers and warehouses, and sends only the options the user set', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    expect((screen.getByLabelText('عمود غريب') as HTMLSelectElement).value).toBe('');

    expect([...(screen.getByLabelText('default_supplier') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'sup-1']);
    expect([...(screen.getByLabelText('warehouse') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'wh-1']);

    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const form = api.mock.calls.find((call) => call[0] === '/purchases/import/preview')?.[1]?.body as FormData;
    // لا تفضيل مُرسَل = يحسمه الخادم من إعداد المؤسسة ويجمّده مع المعاينة
    for (const key of ['default_supplier_id', 'default_payment_type', 'default_tax_rate', 'tax_inclusive', 'warehouse_id']) expect(form.has(key), key).toBe(false);
    expect([form.get('mapping[1]'), form.get('mapping[6]')]).toEqual(['supplier_invoice_ref', 'ignore']);
  });

  it('sends explicit preferences with the preview and freezes the same ones into the job', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('default_supplier'), 'sup-1');
    await user.selectOptions(screen.getByLabelText('default_payment'), 'credit');
    await user.selectOptions(screen.getByLabelText('warehouse'), 'wh-1');
    await user.selectOptions(screen.getByLabelText('tax_inclusive'), 'no');
    await user.type(screen.getByLabelText('default_tax'), '5');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const form = api.mock.calls.find((call) => call[0] === '/purchases/import/preview')?.[1]?.body as FormData;
    expect([form.get('default_supplier_id'), form.get('default_payment_type'), form.get('warehouse_id'), form.get('tax_inclusive'), form.get('default_tax_rate')]).toEqual(['sup-1', 'credit', 'wh-1', '0', '5']);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 2, apply_result: { created: 2 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[default_supplier_id]'), create.get('options[tax_inclusive]'), create.get('options[default_tax_rate]'), create.get('options[warehouse_id]')])
      .toEqual(['purchase_import', 'pv-1', 'sup-1', '0', '5', 'wh-1']);
  });

  it('blocks the preview without a supplier source or a product identifier and for an invalid tax rate', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('المورّد')).toBeTruthy());
    const preview = () => screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement;

    await user.selectOptions(screen.getByLabelText('المورّد'), '');
    expect(screen.getByText('mapping_missing_supplier')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('default_supplier'), 'sup-1');
    expect(preview().disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('الصنف'), '');
    expect(screen.getByText('mapping_missing_product')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('الصنف'), 'sku');
    expect(preview().disabled).toBe(false);

    for (const bad of ['150', '1e1', '5.0', ' 5', '0x10']) {
      await user.clear(screen.getByLabelText('default_tax'));
      await user.type(screen.getByLabelText('default_tax'), bad);
      expect(preview().disabled, `tax "${bad}"`).toBe(true);
    }
    expect(screen.getByText('default_tax_invalid')).toBeTruthy();
    await user.clear(screen.getByLabelText('default_tax'));
    expect(preview().disabled).toBe(false);
  });

  it('shows invoices (not rows) with their lines and totals, and blocks apply while any invoice has an error', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/purchases/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/purchases/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, create_units: 1, error_units: 1, errors: [{ row: 4, messages: ['existing'] }],
          units: [unit(), unit({ row: 4, rows: [4], ordinal: 1, supplier_invoice_ref: 'INV-2', lines: 1, action: 'error', status: 'error', valid: false, existing_purchase: true, messages: ['يوجد فاتورة مشتريات لهذا المورّد'] })] } });
      }
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('INV-2')).toBeTruthy());
    expect(screen.getByText('INV-1')).toBeTruthy();
    expect(screen.getByText('يوجد فاتورة مشتريات لهذا المورّد')).toBeTruthy();
    expect(screen.getByText('preview_drafts_note:5,2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('fix_errors')).toBeTruthy();
  });

  it('applies through a preview-bound durable job and reports the cumulative invoice count, sending no semantic options on apply', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', row_count: 120, processed_rows: 120, apply_result: { created: 20 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    // العدد الكلي = processed_rows التراكمي (فواتير) لا created الخاص بآخر قطعة
    expect(screen.getByText('result_created').parentElement?.textContent).toContain('120');
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
  });

  it('shows a job-creation failure and returns to the preview instead of an empty page', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.reject(new ApiError(422, 'المعاينة منتهية', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('المعاينة منتهية'));
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
  });

  it('never re-applies a stale job after a rule changes: a new preview creates a new job', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    let creates = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/purchases/import/preview') return Promise.resolve({ data: cleanPreview });
      if (path === '/import-jobs' && options?.method === 'POST') { creates += 1; return Promise.resolve({ data: jobFixture({ id: `job-${creates}` }) }); }
      if (path.startsWith('/import-jobs/job-')) return Promise.reject(new ApiError(500, 'تعذّر', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(creates).toBe(1));

    await user.click(screen.getByRole('button', { name: 'step_setup' }));
    await user.selectOptions(screen.getByLabelText('default_payment'), 'cash');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(creates).toBe(2));
    const second = api.mock.calls.filter((call) => call[0] === '/import-jobs' && call[1]?.method === 'POST').at(-1)?.[1]?.body as FormData;
    expect(second.get('options[default_payment_type]')).toBe('cash');
  });

  it('explains a failure after earlier chunks created drafts and offers a fresh start', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 3, error_message: 'تعذّر إنشاء بعض الفواتير.' }) });
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 3, error_message: 'تعذّر إنشاء بعض الفواتير.' }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('partial_failure_note:3')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();
  });

  it('shows the resolved company defaults that will be frozen before the user confirms', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/purchases/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/purchases/import/preview') return Promise.resolve({ data: { ...cleanPreview, default_tax_rate: 5, tax_inclusive: true, default_payment_type: 'credit' } });
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    expect(screen.getByTestId('applied-settings').textContent).toBe('applied_settings:5,inclusive_yes,payment_credit');
  });

  it('does not offer a preview when the inspection failed', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => {
      if (path === '/purchases/import/inspect') return Promise.reject(new ApiError(422, 'ملف تالف', null));
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('ملف تالف'));
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Apply once the job from this preview has ended, because its single-use binding is spent', async () => {
    const user = userEvent.setup();
    render(<PurchaseImportWizard />);
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path.startsWith('/import-jobs/job-1')) return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 0, error_message: 'تعذّر' }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy());
    expect(screen.queryByText(/partial_failure_note/)).toBeNull();   // لا فواتير أُنشئت قبل الفشل

    await user.click(screen.getByRole('button', { name: 'step_preview' }));
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('preview_used')).toBeTruthy();
  });

  it('refuses to continue a job of another domain opened from the URL', async () => {
    window.history.replaceState({}, '', '/purchases/import?job=job-7');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', domain: 'expense_import', status: 'ready', preview_bound: true }) });
      return Promise.resolve({ data: [] });
    });
    render(<PurchaseImportWizard />);

    await waitFor(() => expect(screen.getByText('resumed_wrong_domain')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('resumes a bound job from the URL without a file and refuses an unbound one', async () => {
    window.history.replaceState({}, '', '/purchases/import?job=job-9');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'ready', preview_bound: false }) });
      return Promise.resolve({ data: [] });
    });
    render(<PurchaseImportWizard />);

    await waitFor(() => expect(screen.getByText('resumed_unbound')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
