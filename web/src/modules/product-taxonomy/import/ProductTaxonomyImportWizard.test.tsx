// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductTaxonomyImportWizard } from './ProductTaxonomyImportWizard';

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

const field = (key: string, ar: string, required = false, writable = true) => ({ key, label_ar: ar, label_en: key, type: 'text', required, clearable: false, writable });
const inspection = {
  columns: [
    { index: 0, header: 'الاسم', samples: ['زيوت'], suggested_field: 'name' },
    { index: 1, header: 'مسار الأب', samples: ['زيوت'], suggested_field: 'parent_path' },
    { index: 2, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 3,
  fields: [field('nebrax_id', 'معرّف نبراكس', false, false), field('name', 'الاسم', true), field('parent_path', 'مسار الأب'), field('description', 'الوصف')],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const row = (over: Record<string, unknown> = {}) => ({ row: 2, action: 'create', status: 'ok', valid: true, name: 'فلاتر', path: 'زيوت > فلاتر', creates_parents: [], messages: [], warnings: [], ...over });
const cleanPreview = {
  kind: 'category', total_rows: 3, create_rows: 3, update_rows: 0, skipped_rows: 0, warning_rows: 0, error_rows: 0, implicit_parents: 0,
  rows: [row(), row({ row: 3, name: 'فلاتر هواء', path: 'زيوت > فلاتر > فلاتر هواء', creates_parents: ['زيوت'] })], rows_shown: 2, rows_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'product_taxonomy', status: 'ready', original_filename: 'c.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 3, column_count: 3, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'c.csv', { type: 'text/csv' });

beforeEach(() => {
  window.history.replaceState({}, '', '/inventory-settings/categories/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/product-taxonomy/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/product-taxonomy/import/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});
afterEach(cleanup);

async function previewReady(user: ReturnType<typeof userEvent.setup>, kind: 'category' | 'brand' = 'category') {
  render(<ProductTaxonomyImportWizard kind={kind} />);
  await user.upload(screen.getByLabelText('step_file'), csv());
  await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
}

describe('ProductTaxonomyImportWizard (IMP-H4-S6a)', () => {
  it('inspects with the kind, offers only writable fields plus the Nebrax ID, and sends the policies with the preview', async () => {
    const user = userEvent.setup();
    render(<ProductTaxonomyImportWizard kind="category" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());

    const inspectForm = api.mock.calls.find((call) => call[0] === '/product-taxonomy/import/inspect')?.[1]?.body as FormData;
    expect(inspectForm.get('kind')).toBe('category');
    expect([...(screen.getByLabelText('عمود غريب') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'nebrax_id', 'name', 'parent_path', 'description']);

    await user.selectOptions(screen.getByLabelText('parent_policy'), 'create_missing');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const form = api.mock.calls.find((call) => call[0] === '/product-taxonomy/import/preview')?.[1]?.body as FormData;
    expect([form.get('kind'), form.get('mode'), form.get('blank_policy'), form.get('parent_policy'), form.get('mapping[2]')]).toEqual(['category', 'create', 'ignore', 'create_missing', 'ignore']);
  });

  it('shows no parent policy for brands and never sends one, while categories do show it', async () => {
    const user = userEvent.setup();
    const category = render(<ProductTaxonomyImportWizard kind="category" />);
    expect(screen.getByLabelText('parent_policy')).toBeTruthy();
    category.unmount();

    render(<ProductTaxonomyImportWizard kind="brand" />);
    expect(screen.queryByLabelText('parent_policy')).toBeNull();
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    expect(screen.queryByLabelText('parent_policy')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const form = api.mock.calls.find((call) => call[0] === '/product-taxonomy/import/preview')?.[1]?.body as FormData;
    expect([form.get('kind'), form.has('parent_policy')]).toEqual(['brand', false]);
  });

  it('blocks the preview without a name column (create) and relaxes it for update with the Nebrax ID', async () => {
    const user = userEvent.setup();
    render(<ProductTaxonomyImportWizard kind="category" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('الاسم')).toBeTruthy());
    const preview = () => screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement;

    await user.selectOptions(screen.getByLabelText('الاسم'), '');
    expect(screen.getByText('mapping_missing_name')).toBeTruthy();
    expect(preview().disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('mode'), 'update');
    expect(screen.getByText('mapping_missing_identifier')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('الاسم'), 'nebrax_id');
    expect(preview().disabled).toBe(false);
  });

  it('lists the rows with their paths and the parents a row will create, and blocks Apply while any row has an error', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/product-taxonomy/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/product-taxonomy/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, create_rows: 1, error_rows: 1, implicit_parents: 1, errors: [{ row: 3, messages: ['الأب غير موجود'] }],
          rows: [row(), row({ row: 3, name: 'فلاتر هواء', path: 'زيوت > فلاتر > فلاتر هواء', action: 'error', status: 'error', valid: false, messages: ['الأب غير موجود'], creates_parents: ['زيوت'] })] } });
      }
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<ProductTaxonomyImportWizard kind="category" />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('زيوت > فلاتر')).toBeTruthy());
    expect(screen.getByText('implicit_parents:1')).toBeTruthy();
    expect(screen.getByText('creates_parents:زيوت')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('fix_errors')).toBeTruthy();
  });

  it('applies through a preview-bound durable job and reports the cumulative total plus the last chunk breakdown', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 250, apply_result: { created: 50, updated: 0, skipped: 0 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_processed')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.getByText('result_processed').parentElement?.textContent).toContain('250');
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[kind]'), create.get('options[parent_policy]'), create.get('options[mapping][2]')]).toEqual(['product_taxonomy', 'pv-1', 'category', 'error', 'ignore']);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
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

  it('never re-applies a stale job after a rule changes, and disables Apply once the job from a preview has ended', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    await previewReady(user);

    let creates = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/product-taxonomy/import/preview') return Promise.resolve({ data: cleanPreview });
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

  it('does not offer a preview when the inspection failed', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => {
      if (path === '/product-taxonomy/import/inspect') return Promise.reject(new ApiError(422, 'ملف تالف', null));
      return Promise.resolve({ data: [] });
    });
    const user = userEvent.setup();
    render(<ProductTaxonomyImportWizard kind="brand" />);
    await user.upload(screen.getByLabelText('step_file'), csv());

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('ملف تالف'));
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses to continue an unbound job or one of another domain opened from the URL', async () => {
    window.history.replaceState({}, '', '/inventory-settings/categories/import?job=job-7');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', domain: 'partner_master', status: 'ready', preview_bound: false }) });
      return Promise.resolve({ data: [] });
    });
    render(<ProductTaxonomyImportWizard kind="category" />);

    await waitFor(() => expect(screen.getByText('resumed_wrong_domain')).toBeTruthy());
    expect(screen.getByText('resumed_unbound')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
