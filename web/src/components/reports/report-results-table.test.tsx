import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportResultsTable } from './report-results-table';

afterEach(cleanup);

const columns = [
  { label: 'Customer' },
  { label: 'Invoices', align: 'end' as const },
  { label: 'Amount', align: 'end' as const },
];
const rows = [
  ['Apex Trading', '3', '1,250.00 𞸁'],
  ['Noor Stores', '1', '400.00 𞸁'],
];

function renderResults({ locale = 'en', rowHrefs, reportKey, resultRows = rows }: { locale?: 'en' | 'ar'; rowHrefs?: Array<string | null>; reportKey?: string; resultRows?: string[][] } = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <ReportResultsTable
        columns={columns}
        rows={resultRows}
        totalRow={['Total', '4', '1,650.00 𞸁']}
        emptyText="No report results"
        primaryIndex={0}
        rowHrefs={rowHrefs}
        reportKey={reportKey}
      />
    </NextIntlClientProvider>
  );
}

describe('ReportResultsTable drill-down', () => {
  it('keeps the table unchanged when a report has no drill-down target', () => {
    renderResults();

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByText('Apex Trading')).toHaveLength(2);
    expect(screen.getAllByText('1,650.00 𞸁')).toHaveLength(2);
  });

  it('renders a primary-cell detail link only for rows with a supplied href and keeps it keyboard focusable', () => {
    const { container } = renderResults({ rowHrefs: ['/partners/customer-1', null] });
    const desktop = container.querySelector('.hidden.md\\:block') as HTMLElement;
    const desktopLink = within(desktop).getByRole('link', { name: 'Apex Trading' });

    expect(desktopLink.getAttribute('href')).toBe('/partners/customer-1');
    expect(within(desktop).queryByRole('link', { name: 'Noor Stores' })).toBeNull();
    desktopLink.focus();
    expect(document.activeElement).toBe(desktopLink);
  });

  it('keeps Saved Views reachable from the mobile representation when a stable reportKey is supplied', () => {
    const { container } = renderResults({ reportKey: 'sales:customer' });
    const mobile = container.querySelector('.md\\:hidden') as HTMLElement;

    expect(within(mobile).getByRole('button', { name: 'Views' })).toBeTruthy();
  });

  it('shows an explicit mobile CTA in the active locale without making the entire card clickable', () => {
    const { container } = renderResults({ locale: 'ar', rowHrefs: ['/partners/customer-1', null] });
    const mobile = container.querySelector('.md\\:hidden') as HTMLElement;
    const action = within(mobile).getByRole('link', { name: 'عرض التفاصيل' });

    expect(action.getAttribute('href')).toBe('/partners/customer-1');
    expect(within(mobile).queryByRole('link', { name: 'Noor Stores' })).toBeNull();
  });

  it('renders one explicit empty state without table controls, totals, or Saved Views', () => {
    renderResults({ resultRows: [], reportKey: 'sales:customer' });

    expect(screen.getByRole('status').textContent).toBe('No report results');
    expect(screen.queryByRole('textbox', { name: 'Search results' })).toBeNull();
    expect(screen.queryByText('1,650.00 𞸁')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Views' })).toBeNull();
  });
});
