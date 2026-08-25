import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsWorkspace } from './reports-workspace';
import { GeneralAdvancedReportsWorkspace } from './general-advanced-reports-workspace';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/company', () => ({ useCompany: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/reports/report-filters', () => ({
  EMPTY_FILTERS: { from: '', to: '', branchIds: [] },
  filtersToQuery: (filters: { from: string; to: string }) => filters.to ? `?from=${filters.from}&to=${filters.to}` : '',
  ReportFilters: ({ onChange, comparison }: { onChange: (value: { from: string; to: string; branchIds: string[] }) => void; comparison?: { onChange: (mode: 'previous-period') => void } }) => (
    <>
      <button type="button" onClick={() => onChange({ from: '2026-09-01', to: '2026-09-30', branchIds: [] })}>change report range</button>
      {comparison && <button type="button" onClick={() => comparison.onChange('previous-period')}>enable comparison</button>}
    </>
  ),
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({ ReportMetricGrid: () => null, ReportScreenHeader: () => null }));
vi.mock('@/components/reports/customer-aging-chart', () => ({ CustomerAgingChart: () => null }));
vi.mock('@/components/reports/report-results-table', () => ({ ReportResultsTable: () => null }));
vi.mock('@/components/reports/report-data-table', () => ({ reportCellToneFromValue: () => 'neutral' }));
vi.mock('@/components/reports/structured-financial-statement', () => ({
  StructuredFinancialStatement: ({ sections }: { sections: Array<{ rows: Array<{ label: string }> }> }) => <div>{sections.flatMap((section) => section.rows.map((row) => row.label)).join(' | ')}</div>,
}));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const income = (name: string) => ({ revenues: [{ code: '4110', name, amount: '100.00' }], expenses: [], total_revenue: '100.00', total_expense: '0.00', net_income: '100.00' });
const balance = (name: string) => ({ assets: [{ code: '1110', name, amount: '100.00' }], liabilities: [], equity: [], total_assets: '100.00', total_liabilities: '0.00', total_equity: '0.00', net_income: '100.00', total_equity_and_income: '100.00', balanced: true });
const cashFlow = (description: string) => ({
  operating: { inflows: '100.00', outflows: '0.00', net: '100.00', entries: [{ date: '2026-08-01', number: 'JV-001', description, inflow: '100.00', outflow: '0.00', net: '100.00' }] },
  investing: { inflows: '0.00', outflows: '0.00', net: '0.00', entries: [] },
  financing: { inflows: '0.00', outflows: '0.00', net: '0.00', entries: [] },
  net_cash_flow: '100.00',
});

async function settle<T>(resolve: (value: T) => void, value: T) {
  await act(async () => { resolve(value); });
}

describe('ReportsWorkspace stale current protection', () => {
  it('removes a previous income result when the next current request fails', async () => {
    const first = deferred<ReturnType<typeof income>>();
    const next = deferred<ReturnType<typeof income>>();
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    render(<ReportsWorkspace initialTab="income" allowedTabs={['income']} />);

    await settle(first.resolve, income('August sales'));
    expect(screen.getByText(/August sales/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => { next.reject(new Error('September failed')); });

    await waitFor(() => expect(screen.queryByText(/August sales/)).toBeNull());
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('removes a previous balance snapshot when the next current request fails', async () => {
    const first = deferred<ReturnType<typeof balance>>();
    const next = deferred<ReturnType<typeof balance>>();
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    render(<ReportsWorkspace initialTab="balance" allowedTabs={['balance']} />);

    await settle(first.resolve, balance('August cash'));
    expect(screen.getByText(/August cash/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => { next.reject(new Error('September failed')); });

    await waitFor(() => expect(screen.queryByText(/August cash/)).toBeNull());
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('removes a previous cash-flow result when the next current request fails', async () => {
    const first = deferred<ReturnType<typeof cashFlow>>();
    const next = deferred<ReturnType<typeof cashFlow>>();
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    render(<GeneralAdvancedReportsWorkspace tab="cashflow" heading="Cash flow" />);

    await settle(first.resolve, cashFlow('August cash receipt'));
    expect(screen.getByText(/August cash receipt/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => { next.reject(new Error('September failed')); });

    await waitFor(() => expect(screen.queryByText(/August cash receipt/)).toBeNull());
    expect(screen.getByText('loadFailed')).toBeTruthy();
  });

  it('keeps current income when only its comparison request fails', async () => {
    const initial = deferred<ReturnType<typeof income>>();
    const ranged = deferred<ReturnType<typeof income>>();
    const current = deferred<ReturnType<typeof income>>();
    const comparison = deferred<ReturnType<typeof income>>();
    apiMock.mockReturnValueOnce(initial.promise).mockReturnValueOnce(ranged.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(comparison.promise);
    render(<ReportsWorkspace initialTab="income" allowedTabs={['income']} />);

    await settle(initial.resolve, income('August sales'));
    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await settle(ranged.resolve, income('September current'));
    fireEvent.click(screen.getByRole('button', { name: 'enable comparison' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(4));
    await settle(current.resolve, income('September comparative current'));
    await act(async () => { comparison.reject(new Error('comparison failed')); });

    await waitFor(() => expect(screen.getByText(/September comparative current/)).toBeTruthy());
    expect(screen.queryByText(/August sales/)).toBeNull();
    expect(screen.getByText('comparison_failed')).toBeTruthy();
  });

  it('does not let an older failed request clear a newer income response', async () => {
    const older = deferred<ReturnType<typeof income>>();
    const newer = deferred<ReturnType<typeof income>>();
    apiMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<ReportsWorkspace initialTab="income" allowedTabs={['income']} />);

    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await settle(newer.resolve, income('September sales'));
    await act(async () => { older.reject(new Error('August failed')); });

    await waitFor(() => expect(screen.getByText(/September sales/)).toBeTruthy());
    expect(screen.queryByText('empty')).toBeNull();
  });

  it('does not let an older success overwrite a newer income response', async () => {
    const older = deferred<ReturnType<typeof income>>();
    const newer = deferred<ReturnType<typeof income>>();
    apiMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<ReportsWorkspace initialTab="income" allowedTabs={['income']} />);

    fireEvent.click(screen.getByRole('button', { name: 'change report range' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await settle(newer.resolve, income('September sales'));
    await settle(older.resolve, income('August sales'));

    await waitFor(() => expect(screen.getByText(/September sales/)).toBeTruthy());
    expect(screen.queryByText(/August sales/)).toBeNull();
  });
});
