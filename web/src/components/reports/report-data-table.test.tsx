'use client';

import { cleanup, render, screen, within } from '@testing-library/react';
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

    await user.click(screen.getByRole('button', { name: /Amount/i }));

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
      const [viewState, setViewState] = useState<ReportTableViewState>({ columnVisibility: {}, sorting: [], density: 'compact', pageSize: 10 });
      return <>
        <button type="button" onClick={() => setViewState({ columnVisibility: { date: false }, sorting: [{ id: 'amount', desc: true }], density: 'comfortable', pageSize: 10 })}>Apply saved view</button>
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

  it('uses the supplied empty report message when the source data has no rows', () => {
    renderTable([], null);

    expect(screen.getByText('No report results')).toBeTruthy();
  });
});
