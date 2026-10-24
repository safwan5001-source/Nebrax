// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseImportWizard } from './ExpenseImportWizard';

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
    { index: 0, header: 'التاريخ', samples: ['2026-10-01'], suggested_field: 'expense_date' },
    { index: 1, header: 'المبلغ', samples: ['100'], suggested_field: 'amount' },
    { index: 2, header: 'كود الحساب', samples: ['5130'], suggested_field: 'account_code' },
    { index: 3, header: 'عمود غريب', samples: ['x'], suggested_field: null },
  ],
  total_rows: 2,
  fields: [field('expense_date', 'التاريخ', true), field('amount', 'المبلغ', true), field('account_code', 'كود الحساب'), field('reference', 'المرجع')],
};
const binding = { id: 'pv-1', hash: 'h'.repeat(64), expires_at: '2026-01-01T00:00:00Z' };
const cleanPreview = {
  total_rows: 2, create_rows: 2, warning_rows: 0, error_rows: 0, create_amount_minor: 20000, confirmed_repeat_rows: [],
  rows: [], repeat_candidates: [], rows_shown: 0, rows_truncated: false, errors: [], binding,
};
const repeatRow = { row: 3, action: 'error', status: 'error', valid: false, date: '2026-10-01', amount_minor: 10000, account_code: '5130', vendor: 'شركة', reference: null, confirmed_repeat: false, repeat_candidate: true, messages: ['dup'], warnings: [] };

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', domain: 'expense_import', status: 'ready', original_filename: 'e.csv', extension: 'csv', byte_size: 50, content_sha256: 'x',
    row_count: 2, column_count: 4, processed_rows: 0, apply_result: null, error_message: null, created_by: null, cancelled_by: null,
    cancelled_at: null, purge_after: null, preview_bound: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

const csv = () => new File(['x'], 'e.csv', { type: 'text/csv' });

beforeEach(() => {
  window.history.replaceState({}, '', '/expenses/import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/accounts') return Promise.resolve({ data: [
      { id: 'acc-exp', code: '5130', name: 'الإيجار', type: 'expense', is_group: false, is_active: true },
      { id: 'acc-grp', code: '5000', name: 'مجموعة', type: 'expense', is_group: true, is_active: true },
      { id: 'acc-asset', code: '1110', name: 'الصندوق', type: 'asset', is_group: false, is_active: true },
    ] });
    if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/expenses/import/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});
afterEach(cleanup);

describe('ExpenseImportWizard (IMP-H5-S2b)', () => {
  it('inspects the file, offers only postable expense accounts as default and sends the policies with the preview', async () => {
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('عمود غريب')).toBeTruthy());
    expect((screen.getByLabelText('عمود غريب') as HTMLSelectElement).value).toBe('');

    const options = [...(screen.getByLabelText('default_account') as HTMLSelectElement).options].map((option) => option.value);
    expect(options).toEqual(['', 'acc-exp']);

    await user.selectOptions(screen.getByLabelText('reference_policy'), 'required');
    expect(screen.getByText('mapping_missing_reference')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('reference_policy'), 'optional');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const form = api.mock.calls.find((call) => call[0] === '/expenses/import/preview')?.[1]?.body as FormData;
    expect([form.get('reference_policy'), form.get('default_payment_method'), form.get('default_tax_rate'), form.get('mapping[3]'), form.has('default_account_id')]).toEqual(['optional', 'cash', '15', 'ignore', false]);
  });

  it('blocks the preview without an account source and when the tax rate is invalid', async () => {
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());

    await user.selectOptions(screen.getByLabelText('كود الحساب'), '');
    expect(screen.getByText('mapping_missing_account')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('default_account'), 'acc-exp');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);

    for (const bad of ['150', '1e1', '5.0', ' 5', '0x10', '']) {
      await user.clear(screen.getByLabelText('default_tax'));
      if (bad) await user.type(screen.getByLabelText('default_tax'), bad);
      expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled, `tax "${bad}"`).toBe(true);
    }
    expect(screen.getByText('default_tax_invalid')).toBeTruthy();
    await user.clear(screen.getByLabelText('default_tax'));
    await user.type(screen.getByLabelText('default_tax'), '0');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('applies through a preview-bound durable job freezing the policies and sends no semantic options on apply', async () => {
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', processed_rows: 250, apply_result: { created: 50 } }) });
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalled();
    // العدد الكلي هو processed_rows التراكمي لا created الخاص بآخر قطعة
    expect(screen.getByText('result_created').parentElement?.textContent).toContain('250');
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect([create.get('domain'), create.get('preview_id'), create.get('options[reference_policy]'), create.get('options[default_tax_rate]'), create.get('options[mapping][3]')]).toEqual(['expense_import', 'pv-1', 'optional', '15', 'ignore']);
    expect(create.has('options[confirmed_repeat_rows][]')).toBe(false);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body).toEqual({});
  });

  it('shows a duplicate candidate, re-previews with the explicit confirmation and freezes it into the job', async () => {
    let previews = 0;
    api.mockImplementation((path: string, options?: { method?: string; body?: FormData }) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/expenses/import/preview') {
        previews += 1;
        const confirmed = options?.body?.getAll('confirmed_repeat_rows[]') ?? [];
        return Promise.resolve({ data: confirmed.length === 0
          ? { ...cleanPreview, create_rows: 1, error_rows: 1, errors: [{ row: 3, messages: ['dup'] }], rows: [repeatRow], repeat_candidates: [repeatRow], rows_shown: 1 }
          : { ...cleanPreview, confirmed_repeat_rows: [3], rows: [], repeat_candidates: [{ ...repeatRow, action: 'create', status: 'warning', valid: true, confirmed_repeat: true, repeat_candidate: false, messages: [] }], rows_shown: 0 } });
      }
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.resolve({ data: jobFixture({ status: 'completed', apply_result: { created: 2 } }) });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('repeat_confirm:3')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect((screen.getByRole('button', { name: 'apply' }) as HTMLButtonElement).disabled).toBe(false));
    expect(previews).toBe(2);

    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    const create = api.mock.calls.find((call) => call[0] === '/import-jobs')?.[1]?.body as FormData;
    expect(create.getAll('options[confirmed_repeat_rows][]')).toEqual(['3']);
  });

  it('drops the confirmations when a rule changes, because row numbers belong to one file and rule set', async () => {
    api.mockImplementation((path: string, options?: { body?: FormData }) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/expenses/import/preview') {
        return Promise.resolve({ data: options?.body?.getAll('confirmed_repeat_rows[]').length
          ? { ...cleanPreview, confirmed_repeat_rows: [3], repeat_candidates: [{ ...repeatRow, confirmed_repeat: true, repeat_candidate: false }] }
          : { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['dup'] }], repeat_candidates: [repeatRow] } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true));

    await user.click(screen.getByRole('button', { name: 'back_to_setup' }));
    await user.selectOptions(screen.getByLabelText('default_payment'), 'bank');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false));
    const last = api.mock.calls.filter((call) => call[0] === '/expenses/import/preview').at(-1)?.[1]?.body as FormData;
    expect(last.getAll('confirmed_repeat_rows[]')).toEqual([]);
  });

  it('shows a job-creation failure and returns to the preview instead of an empty page', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.reject(new ApiError(422, 'المعاينة منتهية', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('المعاينة منتهية'));
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
  });

  it('never re-applies a stale job after the file or a rule changes: a new preview creates a new job', async () => {
    const { ApiError } = await import('@/lib/api');
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    let creates = 0;
    api.mockImplementation((path: string, options?: { method?: string; body?: FormData }) => {
      if (path === '/expenses/import/preview') return Promise.resolve({ data: cleanPreview });
      if (path === '/import-jobs' && options?.method === 'POST') { creates += 1; return Promise.resolve({ data: jobFixture({ id: `job-${creates}` }) }); }
      if (path.startsWith('/import-jobs/job-')) return Promise.reject(new ApiError(500, 'تعذّر', null));
      return Promise.resolve({ data: {} });
    });
    await user.click(screen.getByRole('button', { name: 'apply' }));
    await waitFor(() => expect(creates).toBe(1));

    await user.click(screen.getByRole('button', { name: 'step_setup' }));
    await user.selectOptions(screen.getByLabelText('default_payment'), 'bank');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(creates).toBe(2));
    const second = api.mock.calls.filter((call) => call[0] === '/import-jobs' && call[1]?.method === 'POST').at(-1)?.[1]?.body as FormData;
    expect(second.get('options[default_payment_method]')).toBe('bank');
  });

  it('lists a repeat candidate that the truncated preview rows do not contain', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/expenses/import/preview') {
        return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 500, messages: ['dup'] }], rows: [], rows_truncated: true, rows_shown: 200, total_rows: 600, repeat_candidates: [{ ...repeatRow, row: 500 }] } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('repeat_confirm:500')).toBeTruthy());
  });

  it('keeps the previous preview and reverts the checkbox when a confirmation re-preview fails', async () => {
    const { ApiError } = await import('@/lib/api');
    let calls = 0;
    api.mockImplementation((path: string) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/expenses/import/preview') {
        calls += 1;
        if (calls > 1) return Promise.reject(new ApiError(500, 'تعذّرت المعاينة', null));
        return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['dup'] }], repeat_candidates: [repeatRow] } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('تعذّرت المعاينة'));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('repeats_title')).toBeTruthy();
  });

  it('offers a continue action for a job resumed mid-processing and continues it with an empty body', async () => {
    window.history.replaceState({}, '', '/expenses/import?job=job-7');
    let applied = 0;
    api.mockImplementation((path: string) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/import-jobs/job-7') return Promise.resolve({ data: jobFixture({ id: 'job-7', status: 'processing', processed_rows: 100, row_count: 250 }) });
      if (path === '/import-jobs/job-7/apply') { applied += 1; return Promise.resolve({ data: jobFixture({ id: 'job-7', status: 'completed', processed_rows: 250, apply_result: { created: 50 } }) }); }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'continue_apply' })).toBeTruthy());
    expect(applied).toBe(0);
    await user.click(screen.getByRole('button', { name: 'continue_apply' }));

    await waitFor(() => expect(screen.getByText('result_created')).toBeTruthy());
    expect(applied).toBe(1);
    expect(api.mock.calls.find((call) => call[0] === '/import-jobs/job-7/apply')?.[1]?.body).toEqual({});
  });

  it('does not restore stale confirmations when a rule changes while a confirmation re-preview is pending', async () => {
    const second = { ...repeatRow, row: 5 };
    let release: (value: unknown) => void = () => {};
    let previews = 0;
    api.mockImplementation((path: string, options?: { body?: FormData }) => {
      if (path === '/accounts') return Promise.resolve({ data: [] });
      if (path === '/expenses/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/expenses/import/preview') {
        previews += 1;
        const confirmed = (options?.body?.getAll('confirmed_repeat_rows[]') ?? []).map(String);
        if (previews === 3) return new Promise((resolve) => { release = resolve; });   // تبديل الصف 5: معلّق
        return Promise.resolve({ data: { ...cleanPreview, error_rows: 1, errors: [{ row: 3, messages: ['dup'] }], repeat_candidates: [
          { ...repeatRow, confirmed_repeat: confirmed.includes('3'), repeat_candidate: !confirmed.includes('3') },
          { ...second, confirmed_repeat: confirmed.includes('5'), repeat_candidate: !confirmed.includes('5') },
        ] } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ExpenseImportWizard />);
    await user.upload(screen.getByLabelText('step_file'), csv());
    await waitFor(() => expect(screen.getByLabelText('كود الحساب')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));

    await user.click(screen.getAllByRole('checkbox')[0]);                 // تأكيد الصف 3 ينجح
    await waitFor(() => expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true));
    await user.click(screen.getAllByRole('checkbox')[1]);                 // تبديل الصف 5 معلّق
    await user.click(screen.getByRole('button', { name: 'back_to_setup' }));
    await user.selectOptions(screen.getByLabelText('default_payment'), 'bank');   // يُسقط التأكيدات ويتجاوز الطلب المعلّق
    release({ data: cleanPreview });
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(previews).toBe(4));
    const last = api.mock.calls.filter((call) => call[0] === '/expenses/import/preview').at(-1)?.[1]?.body as FormData;
    expect(last.getAll('confirmed_repeat_rows[]')).toEqual([]);
  });
});
