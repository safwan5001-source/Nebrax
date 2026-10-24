// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitTemplateImportWizard } from './UnitTemplateImportWizard';

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
    { index: 0, header: 'قالب', samples: ['أدوات'], suggested_field: 'template_name' },
    { index: 1, header: 'أساس', samples: ['حبة'], suggested_field: 'base_unit' },
    { index: 2, header: 'بديلة', samples: ['كرتون'], suggested_field: 'unit_name' },
    { index: 3, header: 'معامل', samples: ['12'], suggested_field: 'factor' },
    { index: 4, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 3,
  fields: [field('template_name', 'اسم القالب', true), field('base_unit', 'وحدة الأساس', true), field('unit_name', 'الوحدة البديلة'), field('factor', 'المعامل'), field('is_active', 'نشط')],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const row = (over: Record<string, unknown> = {}) => ({
  row: 2, action: 'create', status: 'ok', valid: true, template: 'أدوات', base_unit: 'حبة', unit: 'كرتون', factor: 12, messages: [], warnings: [], ...over,
});
const cleanPreview = {
  existing_policy: 'error', total_rows: 3, template_count: 2, create_templates: 2, skipped_templates: 0, create_units: 3, warning_rows: 0, error_rows: 0,
  rows: [row(), row({ row: 3, unit: 'باكيت', factor: 6 })], rows_shown: 2, rows_truncated: false, errors: [], binding,
};

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'unit_templates', status: 'ready', original_filename: 'u.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 3, column_count: 5, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'u.csv', { type: 'text/csv' });
const defaultApi = (path: string) => {
  if (path === '/unit-templates/import/inspect') return Promise.resolve({ data: inspection });
  if (path === '/unit-templates/import/preview') return Promise.resolve({ data: cleanPreview });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  window.history.replaceState({}, '', '/inventory-settings/units/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation(defaultApi);
});
afterEach(cleanup);

async function inspected(user: ReturnType<typeof userEvent.setup>) {
  render(<UnitTemplateImportWizard />);
  await user.upload(screen.getByLabelText('step_file'), csv());
  await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
}

async function previewReady(user: ReturnType<typeof userEvent.setup>) {
  await inspected(user);
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
}

describe('UnitTemplateImportWizard (IMP-H4-S6c)', () => {
  it('offers every contract field and sends the default policy and the frozen mapping with the preview', async () => {
    const user = userEvent.setup();
    await inspected(user);
    expect([...(screen.getByLabelText('عمود غريب') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'template_name', 'base_unit', 'unit_name', 'factor', 'is_active']);

    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const form = api.mock.calls.find((call) => call[0] === '/unit-templates/import/preview')?.[1]?.body as FormData;
    expect([form.get('existing_policy'), form.get('mapping[0]'), form.get('mapping[3]'), form.get('mapping[4]')]).toEqual(['error', 'template_name', 'factor', 'ignore']);
  });

  it('sends the skip policy when chosen and explains each policy', async () => {
    const user = userEvent.setup();
    await inspected(user);
    expect(screen.getByText('existing_error_hint')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('existing_policy'), 'skip');
    expect(screen.getByText('existing_skip_hint')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    const form = api.mock.calls.find((call) => call[0] === '/unit-templates/import/preview')?.[1]?.body as FormData;
    expect(form.get('existing_policy')).toBe('skip');
  });

  it('blocks the preview without a template name, without a base unit, with an unpaired unit/factor, and on a field mapped twice', async () => {
    const user = userEvent.setup();
    await inspected(user);
    const preview = () => screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement;
    expect(preview().disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('قالب'), '');
    expect(screen.getByText('mapping_missing_name')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('قالب'), 'template_name');

    await user.selectOptions(screen.getByLabelText('أساس'), '');
    expect(screen.getByText('mapping_missing_base_unit')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('أساس'), 'base_unit');

    await user.selectOptions(screen.getByLabelText('معامل'), '');
    expect(screen.getByText('mapping_unpaired')).toBeTruthy();
    expect(preview().disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('بديلة'), '');
    expect(screen.queryByText('mapping_unpaired')).toBeNull();
    expect(preview().disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText('عمود غريب'), 'base_unit');
    expect(screen.getByText('mapping_duplicate')).toBeTruthy();
    expect(preview().disabled).toBe(true);
  });

  it('lists templates with base unit, alternate unit and factor, and blocks Apply while any row has an error', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/unit-templates/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['المعامل خارج النطاق'] }],
          rows: [row(), row({ row: 3, action: 'error', status: 'error', valid: false, factor: null, messages: ['المعامل خارج النطاق'] })] } });
      }
      return defaultApi(path);
    });
    const user = userEvent.setup();
    await inspected(user);
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getAllByText('أدوات').length).toBeGreaterThan(0));
    expect(screen.getAllByText('كرتون').length).toBeGreaterThan(0);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getAllByText('المعامل خارج النطاق').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('fix_errors')).toBeTruthy();
  });

  it('applies through a preview-bound atomic job and reports what was created and skipped', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 3, apply_result: { created: 2, created_units: 3, skipped: 1 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.getByText('result_created').parentElement?.textContent).toContain('2');
    expect(screen.getByText('result_created_units').parentElement?.textContent).toContain('3');
    expect(screen.getByText('result_skipped').parentElement?.textContent).toContain('1');
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[existing_policy]'), create.get('options[mapping][4]')]).toEqual(['unit_templates', 'pv-1', 'error', 'ignore']);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
  });

  it('says nothing was written when the atomic job fails and offers only a fresh start, never a row repair', async () => {
    const user = userEvent.setup();
    await previewReady(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path.startsWith('/import-jobs/job-1')) return Promise.resolve({ data: jobFixture({ status: 'failed', processed_rows: 0, error_message: 'تعذّر', failed_units: 2 }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('failed_nothing_written')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();
    expect(screen.queryByText(/repair/i)).toBeNull();
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
    await waitFor(() => expect(screen.getByText('failed_nothing_written')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'step_preview' }));
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('preview_used')).toBeTruthy();
  });

  it('does not let the stepper jump to a preview that does not exist', async () => {
    window.history.replaceState({}, '', '/inventory-settings/units/import?job=job-9');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-9') return Promise.resolve({ data: jobFixture({ id: 'job-9', status: 'failed', error_message: 'تعذّر' }) });
      return defaultApi(path);
    });
    const user = userEvent.setup();
    render(<UnitTemplateImportWizard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'step_preview' }));
    expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
    expect(screen.getByRole('button', { name: 'start_another' })).toBeTruthy();
  });

  it('does not offer a preview when the inspection failed', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => (path === '/unit-templates/import/inspect' ? Promise.reject(new ApiError(422, 'ملف تالف', null)) : defaultApi(path)));
    const user = userEvent.setup();
    render(<UnitTemplateImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('ملف تالف'));
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never shows or continues a job of another domain opened from the URL, in any status', async () => {
    for (const status of ['ready', 'processing']) {
      window.history.replaceState({}, '', '/inventory-settings/units/import?job=job-7');
      api.mockReset();
      api.mockImplementation((path: string) => {
        if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', domain: 'price_list_items', status, preview_bound: true }) });
        return defaultApi(path);
      });
      const { unmount } = render(<UnitTemplateImportWizard />);

      await waitFor(() => expect(screen.getByText('resumed_wrong_domain')).toBeTruthy());
      expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'continue_apply' })).toBeNull();
      expect(api.mock.calls.some((call) => String(call[0]).endsWith('/apply'))).toBe(false);
      unmount();
    }
  });

  it('refuses to continue an unbound job of this domain opened from the URL, and continues a bound one', async () => {
    window.history.replaceState({}, '', '/inventory-settings/units/import?job=job-8');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-8') return Promise.resolve({ data: jobFixture({ id: 'job-8', status: 'ready', preview_bound: false }) });
      return defaultApi(path);
    });
    const unbound = render(<UnitTemplateImportWizard />);
    await waitFor(() => expect(screen.getByText('resumed_unbound')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);
    unbound.unmount();

    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-8') return Promise.resolve({ data: jobFixture({ id: 'job-8', status: 'processing', preview_bound: true }) });
      return defaultApi(path);
    });
    render(<UnitTemplateImportWizard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'continue_apply' })).toBeTruthy());
  });
});
