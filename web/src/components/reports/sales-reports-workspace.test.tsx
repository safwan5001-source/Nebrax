import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesReportsWorkspace } from './sales-reports-workspace';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/company', () => ({ useCompany: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/reports/sales-report-filters', () => ({
  EMPTY_SALES_REPORT_FILTERS: { from: '', to: '', branchIds: [], interval: 'month', customerId: '', customerClassificationId: '', productId: '', productCategoryId: '', classificationId: '', salespersonId: '', paymentStatus: '', receiptMethod: '' },
  SalesReportFilters: () => <div data-testid="sales-filters" />,
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportScreenHeader: () => <div data-testid="sales-header" />,
  ReportMetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string }> }) => <div data-testid="sales-kpis">{metrics.map((metric) => `${metric.label}:${metric.value}`).join('|')}</div>,
}));
vi.mock('@/components/reports/report-results-table', () => ({
  ReportResultsTable: ({ rows, rowHrefs }: { rows: string[][]; rowHrefs: Array<string | null> }) => <div data-testid="sales-summary-table">{rows.map((row, index) => <a key={row[0]} href={rowHrefs[index] ?? undefined}>{row.join('|')}</a>)}</div>,
}));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const response = {
  view: 'customer',
  data: [{ key: 'customer-1', label: 'Customer A', invoices: 2, amount: '1200.00' }],
  totals: { invoices: 2, net_sales: '1000.00', tax: '200.00', amount: '1200.00' },
  scope: { interval: 'month', source: 'posted_sales_invoices' },
};

describe('SalesReportsWorkspace presentation modes', () => {
  it('defaults to summary, uses the same report row for analytics and summary, and switches safely to unavailable document detail', async () => {
    apiMock.mockResolvedValue(response);
    render(<SalesReportsWorkspace view="customer" />);

    await waitFor(() => expect(screen.getByTestId('sales-summary-table')).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('sales-analytics-customer').textContent).toContain('Customer A');
    expect(screen.getByTestId('sales-summary-table').textContent).toContain('Customer A|2|1,200.00');
    expect(screen.getByTestId('sales-summary-table').querySelector('a')?.getAttribute('href')).toBe('/partners/customer-1');
    expect(screen.getByTestId('sales-kpis').textContent).toContain('invoices:2');

    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('sales-detail-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('sales-analytics-customer')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'summary' }));
    expect(screen.getByTestId('sales-summary-table')).toBeTruthy();
  });

  it('keeps the segmented control usable inside an RTL container', async () => {
    apiMock.mockResolvedValue(response);
    render(<div dir="rtl"><SalesReportsWorkspace view="customer" /></div>);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'presentationMode' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('sales-detail-unavailable')).toBeTruthy();
  });
});
