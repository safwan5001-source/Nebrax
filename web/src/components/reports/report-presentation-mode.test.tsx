import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportPresentationModeControl } from './report-presentation-mode';
import { SalesReportAnalytics } from './sales-report-analytics';

afterEach(cleanup);

describe('ReportPresentationModeControl', () => {
  it('uses an accessible local Summary/Detail control and reports the selected mode', () => {
    const onChange = vi.fn();
    render(<ReportPresentationModeControl value="summary" onChange={onChange} label="Presentation mode" summaryLabel="Summary" detailLabel="Detail" />);

    expect(screen.getByRole('radiogroup', { name: 'Presentation mode' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Summary' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Detail' }));
    expect(onChange).toHaveBeenCalledWith('detail');
  });
});

describe('SalesReportAnalytics', () => {
  const props = {
    view: 'customer' as const,
    loading: false,
    title: 'Top customers by sales',
    description: 'Current filter source.',
    emptyLabel: 'No data in range',
    unassignedLabel: 'Unassigned',
  };

  it.each(['customer', 'product', 'salesperson'] as const)('derives a descending top-six ranking from unordered %s rows without mutating the source', (view) => {
    const rows = [
      { key: 'low-early', label: 'Low early', amount: '10.00' },
      { key: 'top-3', label: 'Third highest', amount: '70.00' },
      { key: 'top-1', label: 'Highest', amount: '100.00' },
      { key: 'below-cutoff', label: 'Below cutoff', amount: '20.00' },
      { key: 'top-6', label: 'Sixth highest', amount: '40.00' },
      { key: 'top-2', label: 'Second highest', amount: '80.00' },
      { key: 'top-5', label: 'Fifth highest', amount: '50.00' },
      { key: 'top-4', label: 'Fourth highest', amount: '60.00' },
    ];
    const sourceOrder = rows.map((row) => row.label);
    const { container } = render(<SalesReportAnalytics {...props} view={view} rows={rows} />);

    expect(screen.getByText('Top customers by sales')).toBeTruthy();
    expect(screen.getByText('Highest')).toBeTruthy();
    expect(screen.getByText('Sixth highest')).toBeTruthy();
    expect(screen.queryByText('Low early')).toBeNull();
    expect(screen.queryByText('Below cutoff')).toBeNull();
    expect(Array.from(container.querySelectorAll('li span:first-child')).map((element) => element.textContent)).toEqual([
      'Highest', 'Second highest', 'Third highest', 'Fourth highest', 'Fifth highest', 'Sixth highest',
    ]);
    expect(rows.map((row) => row.label)).toEqual(sourceOrder);
    expect(container.querySelector(`[data-testid="sales-analytics-${view}"]`)).toBeTruthy();
  });

  it('uses an explicit empty state instead of rendering a decorative chart without meaningful data', () => {
    render(<SalesReportAnalytics {...props} rows={[]} />);
    expect(screen.getByText('No data in range')).toBeTruthy();
  });
});
