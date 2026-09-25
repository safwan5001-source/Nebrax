import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassificationAnalyticsWorkspace } from './classification-analytics-workspace';

const apiMock = vi.hoisted(() => vi.fn());
const downloadCsvMock = vi.hoisted(() => vi.fn());
const toCsvMock = vi.hoisted(() => vi.fn((_headers: string[], rows: string[][]) => JSON.stringify(rows)));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string>) => values ? `${key}:${Object.values(values).join('|')}` : key,
}));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/export', () => ({ toCsv: toCsvMock, downloadCsv: downloadCsvMock }));
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({ id, value, onChange, options, 'aria-label': ariaLabel }: { id: string; value: string; onChange: (next: string) => void; options: Array<{ value: string; label: string }>; 'aria-label': string }) => (
    <select id={id} value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
      <option value="">all</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@/components/reports/report-filters', () => ({
  EMPTY_FILTERS: { from: '', to: '', branchIds: [] },
  ReportFilters: ({ value, onChange }: { value: { from: string }; onChange: (next: unknown) => void }) => <button type="button" data-testid="classification-report-filter" onClick={() => onChange({ ...value, from: value.from ? '' : '2026-01-01' })}>change report filter</button>,
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportMetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string; tone?: string }> }) => <div data-testid="classification-kpis">{metrics.map((metric) => `${metric.label}:${metric.value}:${metric.tone ?? 'neutral'}`).join('|')}</div>,
}));
vi.mock('@/components/reports/report-results-table', () => ({
  ReportResultsTable: ({ rows, totalRow, reportKey }: { rows: string[][]; totalRow: string[]; reportKey: string }) => <div data-testid="classification-summary-table" data-report-key={reportKey}>{rows.map((row, index) => <p key={index}>{row.join('|')}</p>)}<p data-testid="classification-total-row">{totalRow.join('|')}</p></div>,
}));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  downloadCsvMock.mockReset();
  toCsvMock.mockClear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function report(scope = 'sales_invoice', data = classificationRows, totals = classificationTotals) {
  return { scope, data, totals };
}

const classificationRows = [
  { key: 'low', label: 'Low', records: 1, amount: '60.00' },
  { key: 'highest', label: 'Highest', records: 2, amount: '120.00' },
  { key: 'zero-partners', label: 'Zero activity partners', records: 3, amount: '0.00' },
  { key: null, label: null, records: 2, amount: '85.00' },
  { key: 'middle', label: 'Middle', records: 1, amount: '100.00' },
  { key: 'fourth', label: 'Fourth', records: 1, amount: '90.00' },
  { key: 'fifth', label: 'Fifth', records: 1, amount: '80.00' },
  { key: 'sixth', label: 'Sixth', records: 1, amount: '70.00' },
];
const classificationTotals = { records: 12, amount: '605.00', classified_records: 10, unclassified_records: 2 };

function installDefaultApi(initial = report()) {
  apiMock.mockImplementation((url: string) => {
    if (url.startsWith('/reports/classification-analytics')) return Promise.resolve(initial);
    return Promise.resolve({ data: [{ id: 'classification-sales', name: 'Sales class', is_active: true }] });
  });
}

async function renderLoaded(initial = report()) {
  installDefaultApi(initial);
  render(<ClassificationAnalyticsWorkspace />);
  await waitFor(() => expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true'));
}

describe('ClassificationAnalyticsWorkspace modern report behaviour', () => {
  it('defaults to Summary, uses official totals and coverage, ranks an unordered Top 6, preserves Unclassified, and leaves zero-activity rows in the full table without mutation', async () => {
    const original = structuredClone(classificationRows);
    await renderLoaded();

    const ranked = screen.getByTestId('report-ranked-analytics-classification-amount');
    const labels = Array.from(ranked.querySelectorAll('li span:first-child')).map((element) => element.textContent);
    expect(labels).toEqual(['Highest', 'Middle', 'Fourth', 'unclassified', 'Fifth', 'Sixth']);
    expect(labels).toHaveLength(6);
    expect(classificationRows).toEqual(original);
    expect(screen.getByTestId('classification-kpis').textContent).toContain('totalAmount:605.00');
    expect(screen.getByTestId('classification-kpis').textContent).toContain('totalRecords:12');
    expect(screen.getByTestId('classification-coverage').textContent).toContain('coverage.percent:83.3%');
    expect(screen.getByTestId('classification-summary-table').textContent).toContain('Zero activity partners|3|0.00');
    expect(screen.getByTestId('classification-total-row').textContent).toContain('total|12|605.00');
    expect(screen.getByTestId('classification-summary-table').getAttribute('data-report-key')).toBe('classification-analytics:sales_invoice');
  });

  it('renders an em dash for coverage when official total records are zero', async () => {
    await renderLoaded(report('customer', [], { records: 0, amount: '0.00', classified_records: 0, unclassified_records: 0 }));
    expect(screen.getByTestId('classification-coverage').textContent).toContain('coverage.percent:—');
  });

  it('switches to the transparent Detail state and keeps the full CSV dataset unchanged across presentation modes', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    const initialRows = toCsvMock.mock.calls[0]?.[1];
    expect(initialRows).toHaveLength(classificationRows.length + 1);
    expect(initialRows.some((row: string[]) => row[0] === 'unclassified')).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('classification-detail-unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    expect(toCsvMock.mock.calls[1]?.[1]).toEqual(initialRows);
    expect(downloadCsvMock).toHaveBeenCalledTimes(2);
  });

  it('resets Summary, clears classification selection, isolates reportKey, and ignores stale classification options after a scope switch', async () => {
    const salesOptions = deferred<{ data: Array<{ id: string; name: string; is_active: boolean }> }>();
    const paymentOptions = deferred<{ data: Array<{ id: string; name: string; is_active: boolean }> }>();
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith('/reports/classification-analytics')) return Promise.resolve(report(url.includes('scope=payment') ? 'payment' : 'sales_invoice'));
      if (url === '/classifications?scope=sales_invoice') return salesOptions.promise;
      if (url === '/classifications?scope=payment') return paymentOptions.promise;
      return Promise.resolve({ data: [] });
    });
    render(<div dir="rtl"><ClassificationAnalyticsWorkspace /></div>);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'presentation' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('classification'), { target: { value: 'sales-class' } });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'detail' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    fireEvent.change(document.querySelector('#classification-scope') as HTMLSelectElement, { target: { value: 'payment' } });

    await waitFor(() => expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true'));
    expect((screen.getByLabelText('classification') as HTMLSelectElement).value).toBe('');
    await act(async () => { paymentOptions.resolve({ data: [{ id: 'payment-class', name: 'Payment class', is_active: true }] }); });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Payment class' })).toBeTruthy());
    await act(async () => { salesOptions.resolve({ data: [{ id: 'sales-class', name: 'Stale sales class', is_active: true }] }); });
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Stale sales class' })).toBeNull());
    expect(screen.getByTestId('classification-summary-table').getAttribute('data-report-key')).toBe('classification-analytics:payment');
  });

  it('ignores an old late report success after a newer report succeeds', async () => {
    const initial = report();
    const older = deferred<ReturnType<typeof report>>();
    const newest = deferred<ReturnType<typeof report>>();
    let reportCall = 0;
    apiMock.mockImplementation((url: string) => {
      if (!url.startsWith('/reports/classification-analytics')) return Promise.resolve({ data: [] });
      reportCall += 1;
      return reportCall === 1 ? Promise.resolve(initial) : reportCall === 2 ? older.promise : newest.promise;
    });
    render(<ClassificationAnalyticsWorkspace />);
    await waitFor(() => expect(screen.getByText('Highest')).toBeTruthy());
    fireEvent.click(screen.getByTestId('classification-report-filter'));
    fireEvent.click(screen.getByTestId('classification-report-filter'));
    await act(async () => { newest.resolve(report('sales_invoice', [{ key: 'new', label: 'Newest', records: 1, amount: '20.00' }], { records: 1, amount: '20.00', classified_records: 1, unclassified_records: 0 })); });
    await waitFor(() => expect(screen.getByText('Newest')).toBeTruthy());
    await act(async () => { older.resolve(report('sales_invoice', [{ key: 'old', label: 'Older', records: 1, amount: '30.00' }], { records: 1, amount: '30.00', classified_records: 1, unclassified_records: 0 })); });
    expect(screen.queryByText('Older')).toBeNull();
  });

  it('ignores a stale failure after newer success and clears a previous report after a current failure', async () => {
    const staleFailure = deferred<ReturnType<typeof report>>();
    const currentFailure = deferred<ReturnType<typeof report>>();
    let reportCall = 0;
    apiMock.mockImplementation((url: string) => {
      if (!url.startsWith('/reports/classification-analytics')) return Promise.resolve({ data: [] });
      reportCall += 1;
      if (reportCall === 1) return Promise.resolve(report());
      if (reportCall === 2) return staleFailure.promise;
      if (reportCall === 3) return Promise.resolve(report('sales_invoice', [{ key: 'new', label: 'New success', records: 1, amount: '20.00' }], { records: 1, amount: '20.00', classified_records: 1, unclassified_records: 0 }));
      return currentFailure.promise;
    });
    render(<ClassificationAnalyticsWorkspace />);
    await waitFor(() => expect(screen.getByText('Highest')).toBeTruthy());
    fireEvent.click(screen.getByTestId('classification-report-filter'));
    fireEvent.click(screen.getByTestId('classification-report-filter'));
    await waitFor(() => expect(screen.getByText('New success')).toBeTruthy());
    await act(async () => { staleFailure.reject(new Error('late failure')); });
    expect(screen.queryByText('loadFailed')).toBeNull();
    fireEvent.click(screen.getByTestId('classification-report-filter'));
    await act(async () => { currentFailure.reject(new Error('current failure')); });
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy());
    expect(screen.queryByText('New success')).toBeNull();
  });
});
