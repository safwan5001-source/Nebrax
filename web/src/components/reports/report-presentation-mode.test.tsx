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

  it('renders a categorical bar analysis from the same rows and caps the dense mobile-safe ranking at six', () => {
    const { container } = render(<SalesReportAnalytics {...props} rows={[
      { key: '1', label: 'Customer one', amount: '100.00' },
      { key: '2', label: 'Customer two', amount: '90.00' },
      { key: '3', label: 'Customer three', amount: '80.00' },
      { key: '4', label: 'Customer four', amount: '70.00' },
      { key: '5', label: 'Customer five', amount: '60.00' },
      { key: '6', label: 'Customer six', amount: '50.00' },
      { key: '7', label: 'Customer seven', amount: '40.00' },
    ]} />);

    expect(screen.getByText('Top customers by sales')).toBeTruthy();
    expect(screen.getByText('Customer one')).toBeTruthy();
    expect(screen.getByText('Customer six')).toBeTruthy();
    expect(screen.queryByText('Customer seven')).toBeNull();
    expect(container.querySelector('[data-testid="sales-analytics-customer"]')).toBeTruthy();
  });

  it('uses an explicit empty state instead of rendering a decorative chart without meaningful data', () => {
    render(<SalesReportAnalytics {...props} rows={[]} />);
    expect(screen.getByText('No data in range')).toBeTruthy();
  });
});
