'use client';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultReportTableLabels,
  reportCellToneFromValue,
  ReportDataTable,
  type ReportDataColumn,
  type ReportTableViewState,
} from './report-data-table';

afterEach(cleanup);

const labels = defaultReportTableLabels('en');
const columns: ReportDataColumn[] = [
  { id: 'account', label: 'Account', hideable: false },
  { id: 'amount', label: 'Amount', align: 'end', numeric: true },
  { id: 'date', label: 'Date' },
];

function renderTable(rows: string[][], totalRow: string[] | null = ['Total', '2,500.00 𞸁', '']) {
  return render(
    <ReportDataTable
      columns={columns}
      rows={rows}
      totalRow={totalRow}
      labels={labels}
      initialPageSize={10}
      emptyText="No report results"
    />
  );
}

describe('ReportDataTable', () => {
  it('provides locale-appropriate Arabic and English controls', () => {
    expect(defaultReportTableLabels('ar')).toMatchObject({
      search: 'بحث في النتائج',
      previous: 'السابق',
      next: 'التالي',
    });
    expect(defaultReportTableLabels('en')).toMatchObject({
      search: 'Search results',
      previous: 'Previous',
      next: 'Next',
    });
  });

  it('sorts localized financial values numerically instead of alphabetically', async () => {
    const user = userEvent.setup();
    renderTable([
      ['Zakat', '١,٢٥٠٫٠٠ 𞸁', '2026-08-10'],
      ['Assets', '950.00 𞸁', '2026-08-01'],
      ['Cash', '2,500.00 𞸁', '2026-08-05'],
    ]);

    await user.click(screen.getByRole('button', { name: 'Amount' }));

    const bodyRows = within(screen.getByRole('table')).getAllByRole('row').slice(1, 4);
    expect(bodyRows.map((row) => row.textContent?.match(/Zakat|Assets|Cash/)?.[0])).toEqual(['Assets', 'Zakat', 'Cash']);
    expect(screen.getByRole('columnheader', { name: /Amount/i }).getAttribute('aria-sort')).toBe('ascending');
  });

  it('normalizes localized digits while searching and returns to the first page', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 30 }, (_, index) => [
      `Account ${index + 1}`,
      `${index + 1},000.00 𞸁`,
      `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
    ]);
    rows[14] = ['Arabic amount', '١,٢٥٠٫٠٠ 𞸁', '2026-08-15'];
    renderTable(rows);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();

    const search = screen.getByRole('textbox', { name: 'Search results' });
    await user.type(search, '١٢٥٠');

    expect(screen.getByText('Arabic amount')).toBeTruthy();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();

    await user.clear(search);
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });

  it('returns to the first page when an external saved view is applied', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 30 }, (_, index) => [`Account ${index + 1}`, `${index + 1}.00 𞸁`, '2026-08-01']);
    function ControlledTable() {
      const [viewState, setViewState] = useState<ReportTableViewState>({ columnVisibility: {}, sorting: [], density: 'compact', pageSize: 10, columnOrder: [], columnSizing: {} });
      return <>
        <button type="button" onClick={() => setViewState({ columnVisibility: { date: false }, sorting: [{ id: 'amount', desc: true }], density: 'comfortable', pageSize: 10, columnOrder: ['amount', 'account', 'date'], columnSizing: { amount: 200 } })}>Apply saved view</button>
        <ReportDataTable columns={columns} rows={rows} labels={labels} viewState={viewState} onViewStateChange={setViewState} />
      </>;
    }

    render(<ControlledTable />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Apply saved view' }));
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Date' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('aria-sort')).toBe('descending');
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual(['Amount', 'Account']);
  });

  it('keeps the primary column visible while allowing secondary columns to be hidden', async () => {
    const user = userEvent.setup();
    renderTable([['Cash', '1,250.00 𞸁', '2026-08-01']]);

    await user.click(screen.getByRole('button', { name: 'Columns' }));

    expect(screen.queryByRole('checkbox', { name: 'Account' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Amount' }));

    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull();
  });

  it('distinguishes a no-match search from an empty report and keeps report totals available', async () => {
    const user = userEvent.setup();
    renderTable([['Cash', '1,250.00 𞸁', '2026-08-01']]);

    await user.type(screen.getByRole('textbox', { name: 'Search results' }), 'no-match');

    expect(screen.getByText('No results match your search.')).toBeTruthy();
    expect(screen.getByText('2,500.00 𞸁')).toBeTruthy();
  });

  it('applies positive, negative, and neutral semantic tones to profitability cells', () => {
    const profitColumns: ReportDataColumn[] = [
      { id: 'center', label: 'Center' },
      { id: 'profit', label: 'Profit', align: 'end', numeric: true, cellTone: reportCellToneFromValue },
    ];
    render(
      <ReportDataTable
        columns={profitColumns}
        rows={[
          ['North', '120.00 𞸁'],
          ['South', '-45.00 𞸁'],
          ['Central', '0.00 𞸁'],
        ]}
        labels={labels}
      />
    );

    expect(screen.getByText('120.00 𞸁').closest('td')?.className).toContain('text-positive');
    expect(screen.getByText('-45.00 𞸁').closest('td')?.className).toContain('text-negative');
    expect(screen.getByText('0.00 𞸁').closest('td')?.className).not.toMatch(/text-(positive|negative)/);
  });

  it('reorders through accessible controls without breaking sorting, primary drill-down, or hidden-column placement', async () => {
    const user = userEvent.setup();
    render(
      <ReportDataTable
        columns={columns}
        rows={[["Cash", "1,250.00 𞸁", "2026-08-01"]]}
        labels={labels}
        primaryColumnId="account"
        rowActions={[{ href: '/accounts/1', label: 'View details' }]}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('button', { name: 'Move down: Account' }));
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual(['Amount', 'Account', 'Date']);
    expect(screen.getByRole('link', { name: 'Cash' }).getAttribute('href')).toBe('/accounts/1');

    await user.click(screen.getByRole('button', { name: 'Amount' }));
    expect(screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('aria-sort')).toBe('ascending');

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const dateCheckbox = screen.getByRole('checkbox', { name: 'Date' });
    await user.click(dateCheckbox);
    expect(screen.queryByRole('columnheader', { name: 'Date' })).toBeNull();
    await user.click(dateCheckbox);
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual(['Amount', 'Account', 'Date']);
  });

  it('applies constrained column resizing to controlled layout state without changing sort behavior', () => {
    function ControlledLayoutTable() {
      const [viewState, setViewState] = useState<ReportTableViewState>({ columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25, columnOrder: [], columnSizing: {} });
      return <>
        <output data-testid="layout-state">{JSON.stringify(viewState)}</output>
        <ReportDataTable columns={columns} rows={[["Cash", "1,250.00 𞸁", "2026-08-01"]]} labels={labels} viewState={viewState} onViewStateChange={setViewState} resizeDirection="ltr" />
      </>;
    }

    render(<ControlledLayoutTable />);
    const amountHeader = screen.getByRole('columnheader', { name: 'Amount' });
    expect(amountHeader.getAttribute('style')).toContain('width: 144px');
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }));
    expect(amountHeader.getAttribute('aria-sort')).toBe('ascending');

    const resizeHandle = screen.getByRole('button', { name: 'Resize column: Amount' });
    fireEvent.mouseDown(resizeHandle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 1000 });
    fireEvent.mouseUp(document);
    expect(amountHeader.getAttribute('style')).toContain('width: 260px');
    expect(screen.getByTestId('layout-state').textContent).toContain('"amount":260');
    expect(amountHeader.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.mouseDown(resizeHandle, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: -1000 });
    fireEvent.mouseUp(document);
    expect(amountHeader.getAttribute('style')).toContain('width: 120px');

    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const amountCheckbox = screen.getByRole('checkbox', { name: 'Amount' });
    fireEvent.click(amountCheckbox);
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull();
    fireEvent.click(amountCheckbox);
    expect(screen.getByRole('columnheader', { name: 'Amount' }).getAttribute('style')).toContain('width: 120px');
  });

  it('uses the supplied empty report message when the source data has no rows', () => {
    renderTable([], null);

    expect(screen.getByText('No report results')).toBeTruthy();
  });
});
