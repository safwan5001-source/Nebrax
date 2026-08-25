import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PurchasesReportsWorkspace } from './purchases-reports-workspace';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/company', () => ({ useCompany: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/reports/purchases-report-filters', () => ({
  EMPTY_PURCHASE_REPORT_FILTERS: { from: '', to: '', branchIds: [], interval: 'month', supplierId: '', supplierClassificationId: '', productId: '', productCategoryId: '', classificationId: '', creatorId: '', paymentStatus: '', receivedStatus: '', paymentMethod: '' },
  PurchaseReportFilters: ({ value, onChange }: { value: { from: string }; onChange: (next: unknown) => void }) => <button type="button" data-testid="purchase-filter-change" onClick={() => onChange({ ...value, from: value.from ? '' : '2026-02-01' })}>Change filter</button>,
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportScreenHeader: () => <div data-testid="purchase-header" />,
  ReportMetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string }> }) => <div data-testid="purchase-kpis">{metrics.map((metric) => `${metric.label}:${metric.value}`).join('|')}</div>,
}));
vi.mock('@/components/reports/report-results-table', () => ({
  ReportResultsTable: ({ rows, rowHrefs }: { rows: string[][]; rowHrefs: Array<string | null> }) => <div data-testid="purchase-summary-table">{rows.map((row, index) => <a key={row[0]} href={rowHrefs[index] ?? undefined}>{row.join('|')}</a>)}</div>,
}));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function report(data: Array<{ key: string; label: string; purchases: number; amount: string }>) {
  return {
    view: 'supplier',
    data,
    totals: { purchases: data.reduce((total, row) => total + row.purchases, 0), net_purchases: '1000.00', tax: '200.00', amount: '1200.00' },
    scope: { interval: 'month', source: 'posted_purchase_invoices' },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

describe('PurchasesReportsWorkspace presentation modes', () => {
  it('defaults to summary, derives an ordered top ranking from the same unordered supplier rows, and keeps document detail transparent', async () => {
    const response = report([
      { key: 'supplier-low', label: 'Low early supplier', purchases: 1, amount: '10.00' },
      { key: 'supplier-high', label: 'Highest supplier', purchases: 2, amount: '100.00' },
      { key: 'supplier-mid', label: 'Middle supplier', purchases: 1, amount: '50.00' },
    ]);
    apiMock.mockResolvedValue(response);
    render(<PurchasesReportsWorkspace view="supplier" />);

    await waitFor(() => expect(screen.getByTestId('purchase-summary-table')).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true');
    expect(Array.from(screen.getByTestId('purchases-analytics-supplier').querySelectorAll('li span:first-child')).map((element) => element.textContent)).toEqual([
      'Highest supplier', 'Middle supplier', 'Low early supplier',
    ]);
    expect(screen.getByTestId('purchase-summary-table').textContent).toContain('Low early supplier|1|10.00');
    expect(screen.getByTestId('purchase-summary-table').querySelector('a')?.getAttribute('href')).toBe('/partners/supplier-low');
    expect(screen.getByTestId('purchase-kpis').textContent).toContain('purchases:4');

    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('purchases-detail-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('purchases-analytics-supplier')).toBeNull();
  });

  it('keeps the shared presentation control usable inside an RTL container', async () => {
    apiMock.mockResolvedValue(report([{ key: 'supplier-1', label: 'Supplier', purchases: 1, amount: '100.00' }]));
    render(<div dir="rtl"><PurchasesReportsWorkspace view="supplier" /></div>);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'presentationMode' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('purchases-detail-unavailable')).toBeTruthy();
  });

  it('clears current data for a failing newer filter request and ignores an older late response', async () => {
    const initial = report([{ key: 'initial', label: 'Initial supplier', purchases: 1, amount: '100.00' }]);
    const older = deferred<ReturnType<typeof report>>();
    const latest = deferred<ReturnType<typeof report>>();
    apiMock
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise);
    render(<PurchasesReportsWorkspace view="supplier" />);

    await waitFor(() => expect(screen.getByText('Initial supplier')).toBeTruthy());
    fireEvent.click(screen.getByTestId('purchase-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('purchase-summary-table')).toBeNull();
    fireEvent.click(screen.getByTestId('purchase-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));

    latest.resolve(report([{ key: 'latest', label: 'Latest supplier', purchases: 1, amount: '200.00' }]));
    await waitFor(() => expect(screen.getByText('Latest supplier')).toBeTruthy());
    older.resolve(report([{ key: 'older', label: 'Older supplier', purchases: 1, amount: '300.00' }]));
    await waitFor(() => expect(screen.getByText('Latest supplier')).toBeTruthy());
    expect(screen.queryByText('Older supplier')).toBeNull();
  });

  it('shows an explicit failure without retaining a prior summary when the current request fails', async () => {
    apiMock.mockResolvedValueOnce(report([{ key: 'initial', label: 'Initial supplier', purchases: 1, amount: '100.00' }])).mockRejectedValueOnce(new Error('network'));
    render(<PurchasesReportsWorkspace view="supplier" />);

    await waitFor(() => expect(screen.getByText('Initial supplier')).toBeTruthy());
    fireEvent.click(screen.getByTestId('purchase-filter-change'));
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy());
    expect(screen.queryByTestId('purchase-summary-table')).toBeNull();
  });
});
