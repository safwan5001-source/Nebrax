import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryReportsWorkspace, type InventoryReportView } from './inventory-reports-workspace';

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
vi.mock('@/components/reports/inventory-report-filters', () => ({
  EMPTY_INVENTORY_REPORT_FILTERS: { from: '', to: '', branchIds: [], productId: '', warehouseId: '', movementType: '', operationType: '', hideZero: false },
  InventoryReportFilters: ({ value, onChange }: { value: { productId: string }; onChange: (next: unknown) => void }) => <button type="button" data-testid="inventory-filter-change" onClick={() => onChange({ ...value, productId: value.productId ? '' : 'product-filter' })}>change inventory filter</button>,
}));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportMetricGrid: ({ metrics }: { metrics: Array<{ label: string; value: string }> }) => <div data-testid="inventory-kpis">{metrics.map((metric) => `${metric.label}:${metric.value}`).join('|')}</div>,
  ReportScreenHeader: ({ actions }: { actions: Array<{ id: string; onSelect: () => void }> }) => <div>{actions.map((action) => <button key={action.id} type="button" onClick={action.onSelect}>{action.id}</button>)}</div>,
}));
vi.mock('@/components/reports/report-results-table', () => ({
  ReportResultsTable: ({ rows, rowHrefs }: { rows: string[][]; rowHrefs: Array<string | null> }) => <div data-testid="inventory-detail-table">{rows.map((row, index) => <a key={`${row[0]}-${index}`} href={rowHrefs[index] ?? undefined}>{row.join('|')}</a>)}</div>,
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

function inventoryReport(view: InventoryReportView, data: Array<Record<string, unknown>>, totals: Record<string, unknown>) {
  return {
    view,
    data,
    totals,
    scope: { source: view === 'value' ? 'current_tracked_products' : 'posted_stock_movements', snapshot: view === 'value' || view === 'warehouses' },
  };
}

const valueRows = [
  { key: 'product-low', sku: 'LOW', label: 'Low first product', unit: 'pc', quantity: 1, avg_cost: '10.00', stock_value: '10.00' },
  { key: 'product-high', sku: 'HIGH', label: 'Highest product', unit: 'pc', quantity: 4, avg_cost: '25.00', stock_value: '100.00' },
  { key: 'product-mid', sku: 'MID', label: 'Middle product', unit: 'pc', quantity: 2, avg_cost: '20.00', stock_value: '40.00' },
];

async function renderLoaded(view: InventoryReportView, data: Array<Record<string, unknown>>, totals: Record<string, unknown>) {
  apiMock.mockResolvedValueOnce(inventoryReport(view, data, totals));
  render(<InventoryReportsWorkspace view={view} />);
  await waitFor(() => expect(screen.getByRole('radio', { name: 'summary' }).getAttribute('aria-checked')).toBe('true'));
}

describe('InventoryReportsWorkspace presentation modes', () => {
  it('defaults to summary, ranks a copy of value rows, and keeps existing source order and product drill-down in Detail', async () => {
    await renderLoaded('value', valueRows, { products: 3, quantity: 7, stock_value: '150.00' });

    const labels = Array.from(screen.getByTestId('report-ranked-analytics-inventory-value').querySelectorAll('li span:first-child')).map((element) => element.textContent);
    expect(labels).toEqual(['Highest product', 'Middle product', 'Low first product']);
    expect(screen.getByTestId('inventory-kpis').textContent).toContain('products:3');

    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    const detail = screen.getByTestId('inventory-detail-table');
    expect(detail.textContent).toContain('LOW|Low first product|pc|1|10.00');
    expect(detail.textContent?.indexOf('Low first product')).toBeLessThan(detail.textContent?.indexOf('Highest product') ?? 0);
    expect(detail.querySelector('a')?.getAttribute('href')).toBe('/products/product-low');
  });

  it('aggregates warehouse quantities only for the ranked presentation and never introduces warehouse value', async () => {
    await renderLoaded('warehouses', [
      { key: 'product-1', warehouse_id: 'warehouse-a', warehouse: 'Warehouse A', branch: 'North', sku: 'A', label: 'First', unit: 'pc', quantity: 2 },
      { key: 'product-2', warehouse_id: 'warehouse-a', warehouse: 'Warehouse A', branch: 'North', sku: 'B', label: 'Second', unit: 'pc', quantity: 3 },
      { key: 'product-3', warehouse_id: 'warehouse-b', warehouse: 'Warehouse B', branch: 'South', sku: 'C', label: 'Third', unit: 'pc', quantity: 4 },
    ], { warehouses: 2, items: 3, quantity: 9 });

    const analytics = screen.getByTestId('report-ranked-analytics-inventory-warehouses');
    expect(analytics.textContent).toContain('Warehouse A');
    expect(analytics.textContent).toContain('5');
    expect(analytics.textContent).not.toContain('stock_value');
  });

  it('renders the movement in/out comparison from official totals and retains actual rows only in Detail', async () => {
    await renderLoaded('movements', [
      { key: 'movement-1', date: '2026-01-02', type: 'out', label: 'Movement product', warehouse: 'Main', quantity: 3, unit_cost: '10.00', total_cost: '30.00', balance_quantity: 7 },
    ], { movements: 1, in_quantity: 12, out_quantity: 3, in_cost: '120.00', out_cost: '30.00', total_cost: '150.00' });

    expect(screen.getByTestId('inventory-movement-breakdown').textContent).toContain('incomingQuantity');
    expect(screen.getByTestId('inventory-movement-breakdown').textContent).toContain('12');
    expect(screen.getByTestId('inventory-kpis').textContent).toContain('netQuantity:\u200E+9');
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('inventory-detail-table').textContent).toContain('2026-01-02|movementTypes.out|Movement product');
  });

  it('uses a compact operation fallback for one category and a ranked distribution for multiple categories', async () => {
    await renderLoaded('operations', [
      { key: 'permit-1', number: 'SR-1', date: '2026-01-02', type: 'receipt', warehouse: 'Main', lines: 1, quantity: 2, total_cost: '20.00' },
      { key: 'permit-2', number: 'SR-2', date: '2026-01-03', type: 'receipt', warehouse: 'Main', lines: 1, quantity: 3, total_cost: '30.00' },
    ], { operations: 2, lines: 2, quantity: 5, total_cost: '50.00' });
    expect(screen.getByTestId('inventory-operation-breakdown').textContent).toContain('operationTypes.receipt');
    expect(screen.getByTestId('inventory-operation-breakdown').textContent).toContain('2');

    cleanup();
    apiMock.mockResolvedValueOnce(inventoryReport('operations', [
      { key: 'permit-1', number: 'SR-1', type: 'receipt', quantity: 2, total_cost: '20.00' },
      { key: 'permit-2', number: 'SI-1', type: 'issue', quantity: 3, total_cost: '30.00' },
    ], { operations: 2, lines: 2, quantity: 5, total_cost: '50.00' }));
    render(<InventoryReportsWorkspace view="operations" />);
    await waitFor(() => expect(screen.getByTestId('report-ranked-analytics-inventory-operations')).toBeTruthy());
    expect(screen.getByTestId('report-ranked-analytics-inventory-operations').textContent).toContain('operationTypes.issue');
  });

  it('ranks stocktakes by magnitude while visibly retaining the signed source value and stocktake drill-down', async () => {
    await renderLoaded('stocktakes', [
      { key: 'stocktake-small', number: 'STK-1', date: '2026-01-01', warehouse: 'Main', counted_lines: 1, quantity_difference: 1, difference_value: '10.00' },
      { key: 'stocktake-large', number: 'STK-2', date: '2026-01-02', warehouse: 'Main', counted_lines: 1, quantity_difference: -2, difference_value: '-200.00' },
    ], { stocktakes: 2, counted_lines: 2, quantity_difference: -1, difference_value: '-190.00' });

    const analytics = screen.getByTestId('report-ranked-analytics-inventory-stocktakes');
    expect(analytics.textContent?.indexOf('STK-2')).toBeLessThan(analytics.textContent?.indexOf('STK-1') ?? 0);
    expect(analytics.textContent).toContain('-200.00');
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('inventory-detail-table').querySelector('a')?.getAttribute('href')).toBe('/stocktaking/stocktake-small');
  });

  it('keeps the full document export unchanged when switching local presentation mode', async () => {
    await renderLoaded('value', valueRows, { products: 3, quantity: 7, stock_value: '150.00' });
    fireEvent.click(screen.getByRole('button', { name: 'csv' }));
    const first = toCsvMock.mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'csv' }));
    expect(toCsvMock.mock.calls[1]?.[1]).toEqual(first);
    expect(first).toHaveLength(valueRows.length + 1);
    expect(downloadCsvMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the presentation control usable in an RTL container', async () => {
    apiMock.mockResolvedValueOnce(inventoryReport('value', valueRows, { products: 3, quantity: 7, stock_value: '150.00' }));
    render(<div dir="rtl"><InventoryReportsWorkspace view="value" /></div>);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'presentation' })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'detail' }));
    expect(screen.getByTestId('inventory-detail-table')).toBeTruthy();
  });

  it('clears current data, ignores an older late success, and retains only the newest inventory response', async () => {
    const initial = inventoryReport('value', valueRows, { products: 3, quantity: 7, stock_value: '150.00' });
    const older = deferred<ReturnType<typeof inventoryReport>>();
    const newest = deferred<ReturnType<typeof inventoryReport>>();
    apiMock.mockResolvedValueOnce(initial).mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newest.promise);
    render(<InventoryReportsWorkspace view="value" />);

    await waitFor(() => expect(screen.getByText('Highest product')).toBeTruthy());
    fireEvent.click(screen.getByTestId('inventory-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Highest product')).toBeNull();
    fireEvent.click(screen.getByTestId('inventory-filter-change'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));

    await act(async () => { newest.resolve(inventoryReport('value', [{ ...valueRows[0], label: 'Newest product' }], { products: 1, quantity: 1, stock_value: '10.00' })); });
    await waitFor(() => expect(screen.getByText('Newest product')).toBeTruthy());
    await act(async () => { older.resolve(inventoryReport('value', [{ ...valueRows[0], label: 'Older product' }], { products: 1, quantity: 1, stock_value: '10.00' })); });
    await waitFor(() => expect(screen.getByText('Newest product')).toBeTruthy());
    expect(screen.queryByText('Older product')).toBeNull();
  });

  it('shows a fresh failure without retaining a previous inventory result', async () => {
    apiMock.mockResolvedValueOnce(inventoryReport('value', valueRows, { products: 3, quantity: 7, stock_value: '150.00' })).mockRejectedValueOnce(new Error('network'));
    render(<InventoryReportsWorkspace view="value" />);
    await waitFor(() => expect(screen.getByText('Highest product')).toBeTruthy());
    fireEvent.click(screen.getByTestId('inventory-filter-change'));
    await waitFor(() => expect(screen.getByText('loadFailed')).toBeTruthy());
    expect(screen.queryByText('Highest product')).toBeNull();
  });
});
