import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomersReportsWorkspace, type CustomerReportView } from './customers-reports-workspace';

const apiMock = vi.hoisted(() => vi.fn());
const downloadCsvMock = vi.hoisted(() => vi.fn());
const toCsvMock = vi.hoisted(() => vi.fn((_headers: string[], _rows: string[][]) => 'csv-content'));

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/company', () => ({ useCompany: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/export', () => ({ toCsv: toCsvMock, downloadCsv: downloadCsvMock }));
vi.mock('@/modules/documents/components/document-scaler', () => ({ DocumentScaler: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/modules/documents/services/export', () => ({ printDocument: vi.fn() }));
vi.mock('@/modules/reports/services/report-pdf', () => ({ createReportPdf: vi.fn(), downloadReportPdf: vi.fn(), shareReportPdf: vi.fn() }));
vi.mock('@/components/reports/report-document', () => ({ ReportDocument: () => null }));
vi.mock('@/components/charts/area-line', () => ({
  AreaLine: ({ data, label }: { data: number[]; label: string }) => <div data-testid="customer-area-line" aria-label={label}>{data.join('|')}</div>,
  RankedBars: ({ rows }: { rows: Array<{ label: string; displayValue?: string }> }) => <ul>{rows.map((row) => <li key={row.label}><span>{row.label}</span><span>{row.displayValue}</span></li>)}</ul>,
}));
vi.mock('@/components/reports/customer-report-filters', () => ({
  EMPTY_CUSTOMER_REPORT_FILTERS: { from: '', to: '', branchIds: [], interval: 'month', customerId: '', paymentStatus: '', paymentMethod: '', appointmentStatus: '' },
  CustomerReportFilters: ({ value, onChange }: { value: { customerId: string; interval: string }; onChange: (next: unknown) => void }) => (
    <>
      <button type="button" data-testid="customer-filter-change" onClick={() => onChange({ ...value, customerId: value.customerId ? '' : 'customer-filter' })}>change customer filter</button>
      <button type="button" data-testid="customer-interval-change" onClick={() => onChange({ ...value, interval: value.interval === 'month' ? 'week' : 'month' })}>change interval</button>
    </>
  ),
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportMetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string; tone?: string }> }) => <div data-testid="customer-kpis">{metrics.map((metric) => `${metric.label}:${metric.value}:${metric.tone ?? 'neutral'}`).join('|')}</div>,
  ReportScreenHeader: ({ actions }: { actions: Array<{ id: string; onSelect: () => void }> }) => <div>{actions.map((action) => <button key={action.id} type="button" onClick={action.onSelect}>{action.id}</button>)}</div>,
}));
vi.mock('@/components/reports/report-results-table', () => ({
  ReportResultsTable: ({ rows, rowHrefs = [] }: { rows: string[][]; rowHrefs?: Array<string | null> }) => <div data-testid="customer-summary-table">{rows.map((row, index) => <a key={`${row[0]}-${index}`} href={rowHrefs[index] ?? undefined}>{row.join('|')}</a>)}</div>,
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

function customerReport(view: CustomerReportView, data: Array<Record<string, unknown>>, totals: Record<string, unknown>) {
  return {
    view,
    data,
    totals,
    scope: {
      interval: 'month',
      source: view === 'payments' ? 'posted_customer_receipts' : view === 'appointments' ? 'customer_appointments' : 'posted_customer_invoices',
    },
  };
}

async function renderLoaded(view: CustomerReportView, data: Array<Record<string, unknown>>, totals: Record<string, unknown>) {
  apiMock.mockResolvedValueOnce(customerReport(view, data, totals));
  render(<CustomersReportsWorkspace view={view} />);
  await waitFor(() => expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true'));
}

const salesRows = [
  { key: 'customer-low', label: 'Low first customer', invoices: 1, amount: '10.00' },
  { key: 'customer-high', label: 'Highest customer', invoices: 2, amount: '100.00' },
  { key: 'customer-mid', label: 'Middle customer', invoices: 1, amount: '50.00' },
];

describe('CustomersReportsWorkspace presentation modes', () => {
  it('defaults to Summary, ranks unordered sales rows without mutation, uses official KPIs, and keeps the partner drill-down', async () => {
    const original = structuredClone(salesRows);
    await renderLoaded('sales', salesRows, { invoices: 4, net_sales: '120.00', tax: '18.00', amount: '138.00' });

    const analytics = screen.getByTestId('report-ranked-analytics-customer-sales');
    const labels = Array.from(analytics.querySelectorAll('li span:first-child')).map((element) => element.textContent);
    expect(labels).toEqual(['Highest customer', 'Middle customer', 'Low first customer']);
    expect(salesRows).toEqual(original);
    expect(screen.getByTestId('customer-kpis').textContent).toContain('invoices:4');
    expect(screen.getByTestId('customer-kpis').textContent).toContain('netSales:120.00');
    expect(screen.getByTestId('customer-summary-table').querySelector('a')?.getAttribute('href')).toBe('/partners/customer-low');

    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('customers-detail-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('report-ranked-analytics-customer-sales')).toBeNull();
  });

  it('ranks balances by official outstanding balance and keeps customer drill-down while Detail remains transparent', async () => {
    await renderLoaded('balances', [
      { key: 'customer-low', label: 'Low balance', invoices: 1, amount: '20.00', balance: '5.00' },
      { key: 'customer-high', label: 'High balance', invoices: 2, amount: '100.00', balance: '80.00' },
    ], { invoices: 3, amount: '120.00', balance: '85.00' });

    const labels = Array.from(screen.getByTestId('report-ranked-analytics-customer-balances').querySelectorAll('li span:first-child')).map((element) => element.textContent);
    expect(labels).toEqual(['High balance', 'Low balance']);
    expect(screen.getByTestId('customer-summary-table').querySelector('a')?.getAttribute('href')).toBe('/partners/customer-low');
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('customers-detail-unavailable')).toBeTruthy();
  });

  it('uses chronological payment source order for the trend, reads received amount from totals, and never creates a partner drill-down for period buckets', async () => {
    await renderLoaded('payments', [
      { key: '2026-01', label: '2026-01', receipts: 1, amount: '20.00' },
      { key: '2026-02', label: '2026-02', receipts: 2, amount: '100.00' },
      { key: '2026-03', label: '2026-03', receipts: 1, amount: '40.00' },
    ], { receipts: 4, amount: '160.00' });

    expect(screen.getByTestId('customer-area-line').textContent).toBe('20|100|40');
    expect(screen.getByTestId('customer-kpis').textContent).toContain('receivedAmount:160.00');
    expect(screen.getByTestId('customer-summary-table').querySelector('a')?.getAttribute('href')).toBeNull();
    apiMock.mockResolvedValueOnce(customerReport('payments', [], { receipts: 0, amount: '0.00' }));
    fireEvent.click(screen.getByTestId('customer-interval-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(apiMock.mock.calls[1][0]).toContain('interval=week');
  });

  it('uses appointment official totals and an operational customer ranking without financial metric tones', async () => {
    await renderLoaded('appointments', [
      { key: 'customer-low', label: 'Low appointments', appointments: 1, scheduled: 1, done: 0, cancelled: 0 },
      { key: 'customer-high', label: 'High appointments', appointments: 4, scheduled: 1, done: 2, cancelled: 1 },
    ], { appointments: 5, scheduled: 2, done: 2, cancelled: 1 });

    const labels = Array.from(screen.getByTestId('report-ranked-analytics-customer-appointments').querySelectorAll('li span:first-child')).map((element) => element.textContent);
    expect(labels).toEqual(['High appointments', 'Low appointments']);
    expect(screen.getByTestId('customer-kpis').textContent).toContain('appointments:5:neutral');
    expect(screen.getByTestId('customer-kpis').textContent).toContain('cancelled:1:neutral');
    expect(screen.getByTestId('customer-summary-table').querySelector('a')?.getAttribute('href')).toBe('/partners/customer-low');
  });

  it('keeps the full export document unchanged across local presentation modes', async () => {
    await renderLoaded('sales', salesRows, { invoices: 4, net_sales: '120.00', tax: '18.00', amount: '138.00' });
    fireEvent.click(screen.getByRole('button', { name: 'csv' }));
    const firstRows = toCsvMock.mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'csv' }));

    expect(toCsvMock.mock.calls[1]?.[1]).toEqual(firstRows);
    expect(firstRows).toHaveLength(salesRows.length + 1);
    expect(downloadCsvMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the presentation control usable in RTL and resets it to Summary when the report view changes', async () => {
    apiMock.mockResolvedValueOnce(customerReport('sales', salesRows, { invoices: 4, net_sales: '120.00', tax: '18.00', amount: '138.00' }));
    const rendered = render(<div dir="rtl"><CustomersReportsWorkspace view="sales" /></div>);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'presentation' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('customers-detail-unavailable')).toBeTruthy();

    apiMock.mockResolvedValueOnce(customerReport('payments', [], { receipts: 0, amount: '0.00' }));
    rendered.rerender(<div dir="rtl"><CustomersReportsWorkspace view="payments" /></div>);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('clears current data and ignores an older late success after newer customer filters load', async () => {
    const initial = customerReport('sales', salesRows, { invoices: 4, net_sales: '120.00', tax: '18.00', amount: '138.00' });
    const older = deferred<ReturnType<typeof customerReport>>();
    const newest = deferred<ReturnType<typeof customerReport>>();
    apiMock.mockResolvedValueOnce(initial).mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newest.promise);
    render(<CustomersReportsWorkspace view="sales" />);

    await waitFor(() => expect(screen.getByText('Highest customer')).toBeTruthy());
    fireEvent.click(screen.getByTestId('customer-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Highest customer')).toBeNull();
    fireEvent.click(screen.getByTestId('customer-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));

    await act(async () => { newest.resolve(customerReport('sales', [{ key: 'newest', label: 'Newest customer', invoices: 1, amount: '20.00' }], { invoices: 1, net_sales: '20.00', tax: '0.00', amount: '20.00' })); });
    await waitFor(() => expect(screen.getByText('Newest customer')).toBeTruthy());
    await act(async () => { older.resolve(customerReport('sales', [{ key: 'older', label: 'Older customer', invoices: 1, amount: '30.00' }], { invoices: 1, net_sales: '30.00', tax: '0.00', amount: '30.00' })); });
    await waitFor(() => expect(screen.getByText('Newest customer')).toBeTruthy());
    expect(screen.queryByText('Older customer')).toBeNull();
  });

  it('shows a fresh failure without retaining a previous customer report', async () => {
    apiMock.mockResolvedValueOnce(customerReport('sales', salesRows, { invoices: 4, net_sales: '120.00', tax: '18.00', amount: '138.00' })).mockRejectedValueOnce(new Error('network'));
    render(<CustomersReportsWorkspace view="sales" />);
    await waitFor(() => expect(screen.getByText('Highest customer')).toBeTruthy());
    fireEvent.click(screen.getByTestId('customer-filter-change'));
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy());
    expect(screen.queryByText('Highest customer')).toBeNull();
  });
});
