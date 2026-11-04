// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { ImportJob } from '@/modules/import-jobs/client';
import type { InspectResult, PreviewResult } from '../contract';
import { PartnerStatementImportWizard } from './PartnerStatementImportWizard';

const PARTNER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  inspectStatement: vi.fn(),
  previewStatement: vi.fn(),
  downloadTemplate: vi.fn(),
  fetchBranches: vi.fn(),
  fetchPartners: vi.fn(),
  observe: vi.fn(),
  perms: ['partner_statements.view', 'partner_statements.reconcile'] as string[],
  scope: { branches: [] as string[], warehouses: [] as string[] } as { branches: string[]; warehouses: string[] } | null | undefined,
  capability: { state: 'enabled' as 'enabled' | 'suspended' | 'disabled', settled: true, canView: true, canImport: true },
  engine: {
    job: null as null | Record<string, unknown>,
    busy: null as string | null,
    error: null as string | null,
    networkUncertain: false,
    canApply: false,
    upload: vi.fn(),
    applyLoop: vi.fn(),
    resume: vi.fn(),
    reset: vi.fn(),
  },
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
    { raw: () => ({}), rich: (key: string) => key },
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => h.translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('../client', () => ({
  inspectStatement: h.inspectStatement,
  previewStatement: h.previewStatement,
  downloadTemplate: h.downloadTemplate,
  fetchBranches: h.fetchBranches,
  fetchPartners: h.fetchPartners,
}));
vi.mock('../capability', () => ({ usePartnerStatementsCapability: () => ({ ...h.capability, observe: h.observe }) }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ can: (p: string) => h.perms.includes(p) || h.perms.includes('*'), hydrated: true }),
  useActorScope: () => h.scope,
}));
vi.mock('@/modules/import-jobs/useImportJobEngine', () => ({
  useImportJobEngine: () => h.engine,
  useImportJobUrlParam: () => ({ setParam: vi.fn(), getParam: () => null }),
  useResumeFromUrl: () => undefined,
}));
vi.mock('@/modules/import-jobs/MappingPresetBar', () => ({ MappingPresetBar: () => <div data-testid="preset-bar" /> }));
vi.mock('@/modules/import-jobs/ImportJobStatusPanel', () => ({ ImportJobStatusPanel: ({ job }: { job: { status: string } }) => <div data-testid="job-panel">{job.status}</div> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn() }) }));
vi.mock('lucide-react', () => {
  const stub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : stub),
    has: () => true,
  });
});

const inspection: InspectResult = {
  total_rows: 3,
  columns: [
    { index: 0, header: 'التاريخ', samples: ['2026-01-05'], suggested_field: 'line_date' },
    { index: 1, header: 'مدين', samples: ['100.00'], suggested_field: 'debit' },
    { index: 2, header: 'دائن', samples: ['0'], suggested_field: 'credit' },
  ],
  fields: [
    { key: 'line_date', label_ar: 'التاريخ', label_en: 'Date', type: 'date', required: true },
    { key: 'debit', label_ar: 'مدين', label_en: 'Debit', type: 'money', required: false },
    { key: 'credit', label_ar: 'دائن', label_en: 'Credit', type: 'money', required: false },
    { key: 'amount', label_ar: 'المبلغ', label_en: 'Amount', type: 'signed_money', required: false },
  ],
};

const preview = (patch: Partial<PreviewResult> = {}): PreviewResult => ({
  partner_id: PARTNER_ID, partner_name: 'شركة النور', role: 'customer', period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR',
  policy: { version: 1, currency: 'SAR', date_tolerance_days: 3, amount_tolerance_minor: 0, amount_direction: null, include_reversed: true, branch_id: null },
  mapping: { 0: 'line_date', 1: 'debit', 2: 'credit' }, total_rows: 3, line_rows: 3, warning_rows: 0, error_rows: 0, valid_rows: 3, invalid_rows: 0,
  total_debit_minor: 115000, total_credit_minor: 50000,
  checks: { balance_rows: 0, balance_pairs_checked: 0, balance_mismatches: [], balance_mismatches_truncated: false },
  already_imported: false, existing_reconciliation_id: null,
  rows: [{ row: 2, action: 'line', status: 'ok', valid: true, line_date: '2026-01-05', reference: 'INV-1', our_reference: null, description: 'فاتورة', debit_minor: 115000, credit_minor: 0, balance_minor: null, kind: null, messages: [], warnings: [] }],
  rows_shown: 1, rows_truncated: false, errors: [], binding: { id: 'prev-1', hash: 'hash-1' }, ...patch,
});

const job = (patch: Record<string, unknown> = {}) => ({ id: 'job-1', domain: 'partner_statement', status: 'ready', preview_bound: true, original_filename: 'nour.csv', apply_result: null, ...patch });

function resetEngine() {
  Object.assign(h.engine, { job: null, busy: null, error: null, networkUncertain: false, canApply: false });
  h.engine.upload.mockReset().mockImplementation(async () => {
    h.engine.job = job();
    return h.engine.job as unknown as ImportJob;
  });
  h.engine.applyLoop.mockReset().mockResolvedValue(undefined);
  h.engine.resume.mockReset();
  h.engine.reset.mockReset();
}

beforeEach(() => {
  h.perms = ['partner_statements.view', 'partner_statements.reconcile'];
  h.scope = { branches: [], warehouses: [] };
  h.capability = { state: 'enabled', settled: true, canView: true, canImport: true };
  h.inspectStatement.mockReset().mockResolvedValue(inspection);
  h.previewStatement.mockReset().mockResolvedValue(preview());
  h.downloadTemplate.mockReset().mockResolvedValue('downloaded');
  h.fetchBranches.mockReset().mockResolvedValue([{ id: BRANCH_ID, name: 'فرع الدمام', is_active: true }, { id: '33333333-3333-4333-8333-333333333333', name: 'فرع جدة', is_active: true }]);
  h.fetchPartners.mockReset().mockResolvedValue([{ id: PARTNER_ID, name: 'شركة النور', code: 'C-1' }]);
  h.observe.mockReset();
  resetEngine();
});
afterEach(() => cleanup());

const csv = () => new File(['date,debit,credit\n2026-01-05,100.00,0'], 'nour.csv', { type: 'text/csv' });

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('wizard.choose_file'), csv());
  await waitFor(() => expect((screen.getByText('wizard.next') as HTMLButtonElement).closest('button')?.disabled).toBe(false));
}

async function fillSetup(user: ReturnType<typeof userEvent.setup>, options: { branch?: string } = {}) {
  await user.selectOptions(screen.getByLabelText('wizard.role'), 'customer');
  await waitFor(() => expect(screen.getAllByRole('option', { name: /شركة النور/ }).length).toBeGreaterThan(0));
  await user.selectOptions(screen.getByLabelText('wizard.partner'), PARTNER_ID);
  fireEvent.change(screen.getByLabelText('wizard.period_from'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('wizard.period_to'), { target: { value: '2026-03-31' } });
  if (options.branch) await user.selectOptions(screen.getByLabelText('wizard.branch'), options.branch);
}

describe('access gates', () => {
  it('shows view-only users no upload control and makes no API call', async () => {
    h.perms = ['partner_statements.view'];
    render(<PartnerStatementImportWizard />);
    expect(await screen.findByText('wizard.no_permission_title')).toBeTruthy();
    expect(screen.queryByLabelText('wizard.choose_file')).toBeNull();
    expect(h.inspectStatement).not.toHaveBeenCalled();
  });

  it('blocks a disabled capability and a suspended one (read-only) with distinct messages', () => {
    h.capability = { state: 'disabled', settled: true, canView: true, canImport: false };
    const { unmount } = render(<PartnerStatementImportWizard />);
    expect(screen.getByText('state.disabled_title')).toBeTruthy();
    expect(screen.queryByLabelText('wizard.choose_file')).toBeNull();
    unmount();

    h.capability = { state: 'suspended', settled: true, canView: true, canImport: false };
    render(<PartnerStatementImportWizard />);
    expect(screen.getByText('wizard.suspended_title')).toBeTruthy();
    expect(screen.queryByLabelText('wizard.choose_file')).toBeNull();
  });
});

describe('file step', () => {
  it('rejects an oversized or wrong-type file before any request', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<PartnerStatementImportWizard />);
    const input = screen.getByLabelText('wizard.choose_file');

    const big = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await user.upload(input, big);
    expect((await screen.findByRole('alert')).textContent).toContain('errors.file_too_large');

    await user.upload(input, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('errors.file_type'));
    expect(h.inspectStatement).not.toHaveBeenCalled();
  });

  it('shows a mapped message when inspection fails, never the raw server text', async () => {
    h.inspectStatement.mockRejectedValue(new ApiError(422, 'SQLSTATE secret', { message: 'SQLSTATE secret' }));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await user.upload(screen.getByLabelText('wizard.choose_file'), csv());
    expect((await screen.findByRole('alert')).textContent).toContain('errors.validation');
    expect(document.body.textContent).not.toContain('SQLSTATE');
  });

  it('refuses a file above the row limit even if the server inspected it', async () => {
    h.inspectStatement.mockResolvedValue({ ...inspection, total_rows: 2001 });
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await user.upload(screen.getByLabelText('wizard.choose_file'), csv());
    expect((await screen.findByRole('alert')).textContent).toContain('errors.file_too_many_rows');
  });
});

describe('inspection race and branch fallback (review findings)', () => {
  it('ignores the inspection of a superseded file so the newer file keeps its own mapping', async () => {
    const swapped: InspectResult = {
      total_rows: 2,
      columns: [
        { index: 0, header: 'التاريخ', samples: [], suggested_field: 'line_date' },
        { index: 1, header: 'دائن', samples: [], suggested_field: 'credit' },
        { index: 2, header: 'مدين', samples: [], suggested_field: 'debit' },
      ],
      fields: inspection.fields,
    };
    let releaseA: (value: InspectResult) => void = () => {};
    h.inspectStatement
      .mockImplementationOnce(() => new Promise<InspectResult>((resolve) => { releaseA = resolve; }))
      .mockResolvedValueOnce(swapped);
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    const input = screen.getByLabelText('wizard.choose_file');

    await user.upload(input, new File(['a'], 'a.csv', { type: 'text/csv' }));
    await user.upload(input, new File(['b'], 'b.csv', { type: 'text/csv' }));
    await waitFor(() => expect((screen.getByText('wizard.next').closest('button') as HTMLButtonElement).disabled).toBe(false));

    // الملف A يردّ متأخراً بعد B: يجب تجاهله
    releaseA(inspection);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await user.click(screen.getByText('wizard.next'));
    await fillSetup(user);
    await user.click(screen.getByText('wizard.next'));
    await user.click(await screen.findByText('wizard.run_preview'));

    await waitFor(() => expect(h.previewStatement).toHaveBeenCalledTimes(1));
    const [sentFile, options] = h.previewStatement.mock.calls[0];
    expect(sentFile.name).toBe('b.csv');
    expect(options.mapping).toEqual({ 0: 'line_date', 1: 'credit', 2: 'debit' });
  });

  it('discards a preview that was invalidated by an edit while its request was pending', async () => {
    let release: (value: PreviewResult) => void = () => {};
    h.previewStatement.mockImplementationOnce(() => new Promise<PreviewResult>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    await fillSetup(user);
    await user.click(screen.getByText('wizard.next'));
    await user.click(await screen.findByText('wizard.run_preview'));
    await waitFor(() => expect(h.previewStatement).toHaveBeenCalledTimes(1));

    // أثناء الطلب: المستخدم يعدّل المطابقة (عمود المدين ⇒ تجاهل)
    await user.selectOptions(screen.getByLabelText('wizard.mapping_target_for:مدين'), '');
    release(preview());
    await new Promise((resolve) => setTimeout(resolve, 20));

    // المعاينة القديمة لا تُعرض ولا تُنفَّذ: الشاشة ما زالت على المطابقة
    expect(screen.queryByText('wizard.no_blocking_errors')).toBeNull();
    expect(screen.getByText('wizard.run_preview')).toBeTruthy();
    expect(h.engine.upload).not.toHaveBeenCalled();
  });

  it('lets a branch-restricted actor without branches.view still pick an assigned branch (shown by short code)', async () => {
    h.scope = { branches: [BRANCH_ID, '33333333-3333-4333-8333-333333333333'], warehouses: [] };
    h.fetchBranches.mockRejectedValue(new ApiError(403, 'ليست لديك الصلاحية', {}));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));

    const branch = screen.getByLabelText('wizard.branch') as HTMLSelectElement;
    await waitFor(() => expect(within(branch).getAllByRole('option').length).toBe(3));
    expect(within(branch).getByRole('option', { name: `wizard.branch_unnamed:${BRANCH_ID.slice(0, 8)}` })).toBeTruthy();
    expect(screen.getByText('wizard.branch_names_unavailable')).toBeTruthy();
    expect(within(branch).queryByRole('option', { name: 'scope.organization' })).toBeNull();
  });

  it('auto-selects the only assigned branch of a restricted actor', async () => {
    h.scope = { branches: [BRANCH_ID], warehouses: [] };
    h.fetchBranches.mockRejectedValue(new ApiError(403, 'x', {}));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    const branch = screen.getByLabelText('wizard.branch') as HTMLSelectElement;
    await waitFor(() => expect(branch.value).toBe(BRANCH_ID));
  });
});

describe('setup step', () => {
  it('validates required fields before moving on and discloses the frozen policies', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));

    await user.click(screen.getByText('wizard.next'));
    expect(screen.getByText('wizard.role_required')).toBeTruthy();
    expect(screen.getByText('wizard.partner_required')).toBeTruthy();
    expect(screen.getByText('wizard.period_missing')).toBeTruthy();
    expect(screen.getByText('wizard.policies_frozen')).toBeTruthy();
    // العملة ثابتة وغير قابلة للتعديل
    const currency = screen.getByLabelText('wizard.currency') as HTMLInputElement;
    expect(currency.value).toBe('wizard.currency_sar');
    expect(currency.disabled).toBe(true);
  });

  it('keeps the organization-wide option for unrestricted actors', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    const branch = screen.getByLabelText('wizard.branch') as HTMLSelectElement;
    await waitFor(() => expect(within(branch).getAllByRole('option').length).toBe(3));
    expect(within(branch).getByRole('option', { name: 'scope.organization' })).toBeTruthy();
  });

  it('hides the organization-wide option and offers only own branches to a branch-restricted actor', async () => {
    const KHOBAR = '44444444-4444-4444-8444-444444444444';
    h.scope = { branches: [BRANCH_ID, KHOBAR], warehouses: [] };
    h.fetchBranches.mockResolvedValue([
      { id: BRANCH_ID, name: 'فرع الدمام', is_active: true },
      { id: '33333333-3333-4333-8333-333333333333', name: 'فرع جدة', is_active: true },
      { id: KHOBAR, name: 'فرع الخبر', is_active: true },
    ]);
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    const branch = screen.getByLabelText('wizard.branch') as HTMLSelectElement;
    await waitFor(() => expect(within(branch).getAllByRole('option').length).toBe(3));
    expect(within(branch).queryByRole('option', { name: 'scope.organization' })).toBeNull();
    expect(within(branch).queryByRole('option', { name: 'فرع جدة' })).toBeNull();

    await fillSetup(user);
    await user.click(screen.getByText('wizard.next'));
    expect(screen.getByText('wizard.branch_required')).toBeTruthy();
    expect(h.previewStatement).not.toHaveBeenCalled();
  });

  it('normalizes Arabic-Indic digits typed into numeric policy fields to Latin', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    const days = screen.getByLabelText('wizard.date_tolerance') as HTMLInputElement;
    fireEvent.change(days, { target: { value: '٧' } });
    expect(days.value).toBe('7');
    const amount = screen.getByLabelText('wizard.amount_tolerance') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '١٢.٥٠' } });
    expect(amount.value).toBe('12.50');
  });
});

describe('full happy path: file → setup → mapping → preview → confirm → import', () => {
  it('sends frozen, identical options to preview and job creation, and only after explicit acknowledgement', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    expect(h.inspectStatement).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('wizard.next'));
    await fillSetup(user, { branch: BRANCH_ID });
    fireEvent.change(screen.getByLabelText('wizard.amount_tolerance'), { target: { value: '1.50' } });
    await user.click(screen.getByText('wizard.next'));

    // مطابقة الأعمدة مقترحة من الخادم ويظهر شريط المطابقات المحفوظة
    expect(await screen.findByTestId('preset-bar')).toBeTruthy();
    await user.click(screen.getByText('wizard.run_preview'));

    await waitFor(() => expect(h.previewStatement).toHaveBeenCalledTimes(1));
    const [sentFile, options] = h.previewStatement.mock.calls[0];
    expect(sentFile.name).toBe('nour.csv');
    expect(options).toMatchObject({
      partnerId: PARTNER_ID, role: 'customer', periodFrom: '2026-01-01', periodTo: '2026-03-31', branchId: BRANCH_ID,
      dateToleranceDays: 3, amountToleranceMinor: 150, amountDirection: null, mapping: { 0: 'line_date', 1: 'debit', 2: 'credit' },
    });

    // المعاينة: إجماليات من الخادم بأرقام لاتينية
    await screen.findByText(/wizard\.no_blocking_errors/);
    expect(document.body.textContent).toContain('1,150.00');
    expect(document.body.textContent).toContain('500.00');
    await user.click(screen.getByText('wizard.next'));

    // التأكيد: لا استيراد قبل الإقرار
    const importButton = (await screen.findByText('wizard.import_now')).closest('button') as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    await user.click(importButton);
    expect(h.engine.upload).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    expect(importButton.disabled).toBe(false);
    await user.click(importButton);

    await waitFor(() => expect(h.engine.upload).toHaveBeenCalledTimes(1));
    const [uploaded, key, archive, bound] = h.engine.upload.mock.calls[0];
    expect(uploaded.name).toBe('nour.csv');
    expect(key).toBeUndefined();
    expect(archive).toBeNull();
    expect(bound.binding).toMatchObject({ id: 'prev-1', hash: 'hash-1' });
    expect(bound.options).toEqual({
      partner_id: PARTNER_ID, role: 'customer', period_from: '2026-01-01', period_to: '2026-03-31', date_tolerance_days: 3,
      amount_tolerance_minor: 150, branch_id: BRANCH_ID, mapping: { 0: 'line_date', 1: 'debit', 2: 'credit' },
    });
    // التنفيذ يرث الخيارات المجمَّدة: لا خيارات دلالية في /apply
    await waitFor(() => expect(h.engine.applyLoop).toHaveBeenCalledWith('job-1', {}));
  });
});

describe('preview verdicts', () => {
  async function toPreview(user: ReturnType<typeof userEvent.setup>) {
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    await fillSetup(user);
    await user.click(screen.getByText('wizard.next'));
    await user.click(await screen.findByText('wizard.run_preview'));
  }

  it('blocks rows with errors: lists them and offers no way forward', async () => {
    h.previewStatement.mockResolvedValue(preview({ error_rows: 2, valid_rows: 1, errors: [{ row: 3, messages: ['التاريخ غير صالح'] }] }));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await toPreview(user);
    expect(await screen.findByText(/wizard.blocking_errors/)).toBeTruthy();
    expect(screen.getByText(/التاريخ غير صالح/)).toBeTruthy();
    expect((screen.getByText('wizard.next').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('routes an already-imported statement to the existing reconciliation and blocks a second import', async () => {
    h.previewStatement.mockResolvedValue(preview({ already_imported: true, existing_reconciliation_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await toPreview(user);
    expect(await screen.findByText('wizard.already_imported')).toBeTruthy();
    const link = screen.getByText('wizard.open_existing').closest('a');
    expect(link?.getAttribute('href')).toBe('/partner-statements/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    expect((screen.getByText('wizard.next').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a stale-preview rejection with a safe, translated message', async () => {
    h.previewStatement.mockRejectedValue(new ApiError(422, 'x', { message: 'x', code: 'preview_expired' }));
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await toPreview(user);
    expect((await screen.findByRole('alert')).textContent).toContain('errors.preview_stale');
  });

  it('reports a suspended/disabled 403 to the capability observer', async () => {
    const forbidden = new ApiError(403, 'هذه القدرة معلّقة (قراءة فقط)', { message: 'هذه القدرة معلّقة (قراءة فقط)' });
    h.previewStatement.mockRejectedValue(forbidden);
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await toPreview(user);
    await waitFor(() => expect(h.observe).toHaveBeenCalledWith(forbidden));
  });
});

describe('result step', () => {
  it('links a created import to its reconciliation', async () => {
    h.engine.job = job({ status: 'completed', apply_result: { reconciliation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created: 1, replayed: false, lines: 12 } });
    render(<PartnerStatementImportWizard />);
    const open = await screen.findByText('wizard.open_result');
    expect(open.closest('a')?.getAttribute('href')).toBe('/partner-statements/ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(screen.getByText(/wizard.result_created:12/)).toBeTruthy();
  });

  it('explains a replay (same file imported before) and still links to the existing reconciliation', async () => {
    h.engine.job = job({ status: 'completed', apply_result: { reconciliation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created: 0, skipped: 1, replayed: true } });
    render(<PartnerStatementImportWizard />);
    expect(await screen.findByText('wizard.result_replayed')).toBeTruthy();
    expect(screen.queryByText(/wizard.result_created/)).toBeNull();
    expect(screen.getByText('wizard.open_result').closest('a')?.getAttribute('href')).toContain('/partner-statements/ffffffff');
  });

  it('never renders a broken link when the result carries no reconciliation id', async () => {
    h.engine.job = job({ status: 'completed', apply_result: { created: 1 } });
    render(<PartnerStatementImportWizard />);
    expect(await screen.findByText('wizard.back_to_list')).toBeTruthy();
    expect(screen.queryByText('wizard.open_result')).toBeNull();
  });

  it('shows an engine failure with a translated message and a way to start over', async () => {
    h.engine.job = job({ status: 'failed', error_message: 'internal' });
    h.engine.error = 'SQLSTATE[HY000] internal detail';
    render(<PartnerStatementImportWizard />);
    expect((await screen.findByRole('alert')).textContent).toContain('errors.unknown');
    expect(document.body.textContent).not.toContain('SQLSTATE');
    expect(screen.getByText('wizard.start_over')).toBeTruthy();
  });
});

describe('accessibility basics', () => {
  it('labels every form control on the setup step', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementImportWizard />);
    await uploadFile(user);
    await user.click(screen.getByText('wizard.next'));
    for (const label of ['wizard.role', 'wizard.partner', 'wizard.period_from', 'wizard.period_to', 'wizard.branch', 'wizard.currency', 'wizard.date_tolerance', 'wizard.amount_tolerance']) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
  });

  it('exposes the step list as a labelled navigation landmark', () => {
    render(<PartnerStatementImportWizard />);
    expect(screen.getByRole('navigation', { name: 'wizard.steps_label' })).toBeTruthy();
  });
});
