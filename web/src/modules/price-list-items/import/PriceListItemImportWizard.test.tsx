// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceListItemImportWizard } from './PriceListItemImportWizard';

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

const lists = [
  { id: 'pl-1', name: 'جملة', is_active: true },
  { id: 'pl-2', name: 'قديمة', is_active: false },
  { id: 'pl-3', name: 'تجزئة', is_active: true },
];
const field = (key: string, ar: string, required = false) => ({ key, label_ar: ar, label_en: key, type: 'text', required });
const inspection = {
  columns: [
    { index: 0, header: 'رمز', samples: ['A-1'], suggested_field: 'sku' },
    { index: 1, header: 'عبوة', samples: ['كرتون'], suggested_field: 'unit_name' },
    { index: 2, header: 'ثمن', samples: ['25.00'], suggested_field: 'price' },
    { index: 3, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 3,
  fields: [field('nebrax_id', 'معرّف نبراكس'), field('sku', 'رمز الصنف'), field('unit_name', 'الوحدة'), field('price', 'السعر', true)],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const row = (over: Record<string, unknown> = {}) => ({
  row: 2, action: 'update', status: 'ok', valid: true, sku: 'A-1', product_name: 'زيت محرك', unit: null, price: 2500, current_price: 2000, messages: [], warnings: [], ...over,
});
const cleanPreview = {
  price_list_id: 'pl-1', price_list_name: 'جملة', mode: 'upsert', total_rows: 3, create_rows: 1, update_rows: 2, skipped_rows: 0, warning_rows: 0, error_rows: 0,
  rows: [row(), row({ row: 3, action: 'create', sku: 'A-2', product_name: 'فلتر', unit: 'كرتون', price: 28000, current_price: null })], rows_shown: 2, rows_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'price_list_items', status: 'ready', original_filename: 'p.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 3, column_count: 4, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'p.csv', { type: 'text/csv' });
const defaultApi = (path: string) => {
  if (path === '/price-lists') return Promise.resolve({ data: lists });
  if (path === '/price-lists/import/inspect') return Promise.resolve({ data: inspection });
  if (path === '/price-lists/import/preview') return Promise.resolve({ data: cleanPreview });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  window.history.replaceState({}, '', '/sales-settings/pricelists/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation(defaultApi);
});
afterEach(cleanup);

async function chooseList(user: ReturnType<typeof userEvent.setup>, id = 'pl-1') {
  await waitFor(() => expect((screen.getByLabelText('price_list') as HTMLSelectElement).disabled).toBe(false));
  await user.selectOptions(screen.getByLabelText('price_list'), id);
}

async function previewReady(user: ReturnType<typeof userEvent.setup>) {
  render(<PriceListItemImportWizard />);
  await chooseList(user);
  await user.upload(screen.getByLabelText('step_file'), csv());
  await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
}

describe('PriceListItemImportWizard (IMP-H4-S6b)', () => {
  it('offers only active lists and takes no file until a list is chosen, since the server needs it even to inspect', async () => {
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await waitFor(() => expect((screen.getByLabelText('price_list') as HTMLSelectElement).disabled).toBe(false));

    expect([...(screen.getByLabelText('price_list') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'pl-1', 'pl-3']);
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('price_list_first')).toBeTruthy();
    expect(api.mock.calls.some((call) => call[0] === '/price-lists/import/inspect')).toBe(false);

    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    expect((screen.getByLabelText('step_file') as HTMLInputElement).disabled).toBe(false);
  });

  it('sends the list to the inspection, maps the contract fields, and sends the frozen options with the preview', async () => {
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await chooseList(user, 'pl-3');
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());

    const inspectForm = api.mock.calls.find((call) => call[0] === '/price-lists/import/inspect')?.[1]?.body as FormData;
    expect(inspectForm.get('price_list_id')).toBe('pl-3');
    expect([...(screen.getByLabelText('عمود غريب') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'nebrax_id', 'sku', 'unit_name', 'price']);

    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const form = api.mock.calls.find((call) => call[0] === '/price-lists/import/preview')?.[1]?.body as FormData;
    expect([form.get('price_list_id'), form.get('mode'), form.get('mapping[0]'), form.get('mapping[2]'), form.get('mapping[3]')]).toEqual(['pl-3', 'upsert', 'sku', 'price', 'ignore']);
  });

  it('blocks the preview without a price column or without a product identifier, and on a field mapped twice', async () => {
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await chooseList(user);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('ثمن')).toBeTruthy());
    const preview = () => screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement;
    expect(preview().disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('ثمن'), '');
    expect(screen.getByText('mapping_missing_price')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('ثمن'), 'price');

    await user.selectOptions(screen.getByLabelText('رمز'), '');
    expect(screen.getByText('mapping_missing_identifier')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('رمز'), 'nebrax_id');
    expect(preview().disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('عمود غريب'), 'price');
    expect(screen.getByText('mapping_duplicate')).toBeTruthy();
    expect(preview().disabled).toBe(true);
  });

  it('shows the target list, the new and current prices in riyals, and blocks Apply while any row has an error', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/price-lists/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['وحدة غير معروفة'] }],
          rows: [row(), row({ row: 3, action: 'error', status: 'error', valid: false, price: null, current_price: null, messages: ['وحدة غير معروفة'] })] } });
      }
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await chooseList(user);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('target_list:جملة')).toBeTruthy());
    expect(screen.getAllByText('زيت محرك').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/25\.00/).length).toBeGreaterThan(0);    // السعر الجديد: 2500 هللة
    expect(screen.getAllByText(/20\.00/).length).toBeGreaterThan(0);    // السعر الحالي: 2000 هللة
    expect(screen.getAllByText('وحدة غير معروفة').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('fix_errors')).toBeTruthy();
  });

  it('applies through a preview-bound durable job that carries the frozen list, mode and mapping', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 250, apply_result: { created: 10, updated: 40, skipped: 0 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_processed')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.getByText('result_processed').parentElement?.textContent).toContain('250');
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[price_list_id]'), create.get('options[mode]'), create.get('options[mapping][3]')]).toEqual(['price_list_items', 'pv-1', 'pl-1', 'upsert', 'ignore']);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
  });

  it('freezes the newly chosen list into the next preview and job after going back to change it', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    await user.click(screen.getByRole('button', { name: 'step_setup' }));
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-3');

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/price-lists/import/preview') return Promise.resolve({ data: { ...cleanPreview, price_list_id: 'pl-3', price_list_name: 'تجزئة' } });
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByText('target_list:تجزئة')).toBeTruthy());
    const preview = api.mock.calls.filter((call) => call[0] === '/price-lists/import/preview').at(-1)?.[1]?.body as FormData;
    expect(preview.get('price_list_id')).toBe('pl-3');
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(api.mock.calls.some((call) => call[0] === '/import-jobs')).toBe(true));
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect(create.get('options[price_list_id]')).toBe('pl-3');
  });

  it('pre-selects the list from the URL only when it is active and known', async () => {
    window.history.replaceState({}, '', '/sales-settings/pricelists/import?price_list_id=pl-3');
    const known = render(<PriceListItemImportWizard />);
    await waitFor(() => expect((screen.getByLabelText('price_list') as HTMLSelectElement).value).toBe('pl-3'));
    known.unmount();

    for (const wanted of ['pl-2', 'nope']) {
      window.history.replaceState({}, '', `/sales-settings/pricelists/import?price_list_id=${wanted}`);
      const { unmount } = render(<PriceListItemImportWizard />);
      await waitFor(() => expect((screen.getByLabelText('price_list') as HTMLSelectElement).disabled).toBe(false));
      expect((screen.getByLabelText('price_list') as HTMLSelectElement).value).toBe('');
      unmount();
    }
  });

  it('says so when no active list exists or the lists cannot be loaded, and offers no preview', async () => {
    api.mockImplementation((path: string) => (path === '/price-lists' ? Promise.resolve({ data: [lists[1]] }) : defaultApi(path)));
    const empty = render(<PriceListItemImportWizard />);
    await waitFor(() => expect(screen.getByText('price_list_empty')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    empty.unmount();

    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => (path === '/price-lists' ? Promise.reject(new ApiError(500, 'x', null)) : defaultApi(path)));
    render(<PriceListItemImportWizard />);
    await waitFor(() => expect(screen.getByText('price_list_load_failed')).toBeTruthy());
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

  it('disables Apply once the job from this preview has ended, because its single-use binding is spent', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path.startsWith('/import-jobs/job-1')) return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 0, error_message: 'تعذّر' }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getAllByText('تعذّر').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'step_preview' }));
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('preview_used')).toBeTruthy();
  });

  it('explains a failure after earlier chunks applied rows; no note when nothing was applied', async () => {
    for (const processed of [3, 0]) {
      window.history.replaceState({}, '', '/sales-settings/pricelists/import');
      api.mockReset();
      api.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
        if (path.startsWith('/import-jobs/job-1')) return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: processed, error_message: 'تعذّر' }) });
        return defaultApi(path);
      });
      const user = userEvent.setup();
      const { unmount } = render(<PriceListItemImportWizard />);
      await chooseList(user);
      await user.upload(screen.getByLabelText('step_file'), csv());
      await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'run_preview' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'apply' }));

      await waitFor(() => expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy());
      if (processed > 0) expect(screen.getByText(`partial_failure_note:${processed}`)).toBeTruthy();
      else expect(screen.queryByText(/partial_failure_note/)).toBeNull();
      unmount();
    }
  });

  it('does not let the stepper jump to a preview that does not exist', async () => {
    window.history.replaceState({}, '', '/sales-settings/pricelists/import?job=job-9');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'failed', processed_rows: 1, error_message: 'تعذّر' }) });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'step_preview' }));
    expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
    expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();
  });

  it('does not offer a preview when the inspection failed', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => (path === '/price-lists/import/inspect' ? Promise.reject(new ApiError(422, 'ملف تالف', null)) : defaultApi(path)));
    const user = userEvent.setup();
    render(<PriceListItemImportWizard />);
    await chooseList(user);
    await user.upload(screen.getByLabelText('step_file'), csv());

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('ملف تالف'));
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never shows or continues a job of another domain opened from the URL, in any status', async () => {
    for (const status of ['ready', 'processing']) {
      window.history.replaceState({}, '', '/sales-settings/pricelists/import?job=job-7');
      api.mockReset();
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', domain: 'partner_master', status, preview_bound: true }) });
        return defaultApi(path);
      });
      const { unmount } = render(<PriceListItemImportWizard />);

      await waitFor(() => expect(screen.getByText('resumed_wrong_domain')).toBeTruthy());
      expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'continue_apply' })).toBeNull();
      expect(api.mock.calls.some((call) => String(call[0]).endsWith('/apply'))).toBe(false);
      unmount();
    }
  });

  it('refuses to continue an unbound job of this domain opened from the URL', async () => {
    window.history.replaceState({}, '', '/sales-settings/pricelists/import?job=job-8');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-8') return Promise.resolve({ data: jobFixture({ id: 'job-8', status: 'ready', preview_bound: false }) });
      return defaultApi(path);
    });
    render(<PriceListItemImportWizard />);

    await waitFor(() => expect(screen.getByText('resumed_unbound')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets a repair child inherit its frozen options on resume: Apply and Continue stay available without a preview binding', async () => {
    for (const status of ['ready', 'processing']) {
      window.history.replaceState({}, '', '/sales-settings/pricelists/import?job=job-r');
      api.mockReset();
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-r') return Promise.resolve({ data: jobFixture({ id: 'job-r', status, preview_bound: false, parent_job_id: 'job-0' }) });
        return defaultApi(path);
      });
      const { unmount } = render(<PriceListItemImportWizard />);

      await waitFor(() => expect(screen.getByRole('button', { name: status === 'ready' ? 'apply' : 'continue_apply' })).toBeTruthy());
      expect(screen.queryByText('resumed_unbound')).toBeNull();
      if (status === 'ready') expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(false);
      unmount();
    }
  });
});
