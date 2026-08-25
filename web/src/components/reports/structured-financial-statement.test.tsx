import { cleanup, render, within } from '@testing-library/react';
import { NextIntlClientProvider, type useTranslations } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { CashFlowTable } from './general-advanced-reports-workspace';
import { StructuredFinancialStatement, type FinancialStatementSection } from './structured-financial-statement';

afterEach(cleanup);

const financialSections: FinancialStatementSection[] = [
  {
    id: 'revenues',
    label: 'Revenues',
    rows: [
      { id: 'revenue-4100', kind: 'detail', code: '4100', label: 'Sales revenue', amount: '1250.00', href: '/accounts/account-4100' },
      { id: 'total-revenue', kind: 'subtotal', label: 'Total revenue', amount: '1250.00', tone: 'positive' },
    ],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    rows: [
      { id: 'expense-5100', kind: 'detail', code: '5100', label: 'Cost of sales', amount: '400.00' },
      { id: 'total-expense', kind: 'subtotal', label: 'Total expense', amount: '400.00', tone: 'negative' },
    ],
  },
];

function renderStatement({ locale = 'en', sections = financialSections }: { locale?: 'en' | 'ar'; sections?: FinancialStatementSection[] } = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <StructuredFinancialStatement
        descriptionLabel="Account"
        amountLabel="Amount"
        sections={sections}
        grandTotal={{ id: 'net-income', kind: 'grand-total', label: 'Net income', amount: '850.00', tone: 'auto' }}
      />
    </NextIntlClientProvider>,
  );
}

const generalLabels: Record<string, string> = {
  operating: 'Operating activities',
  investing: 'Investing activities',
  financing: 'Financing activities',
  netCashFlow: 'Net cash flow',
  cashFlow: 'Direct cash flow',
  description: 'Description',
  empty: 'No data in range',
};
const g = ((key: string) => generalLabels[key] ?? key) as ReturnType<typeof useTranslations>;

const cashFlow = {
  operating: {
    inflows: '900.00', outflows: '200.00', net: '700.00',
    entries: [{ date: '2026-08-01', number: 'JV-001', description: 'Cash sale', inflow: '900.00', outflow: '0.00', net: '900.00' }],
  },
  investing: {
    inflows: '0.00', outflows: '300.00', net: '-300.00',
    entries: [{ date: '2026-08-02', number: 'JV-002', description: 'Asset purchase', inflow: '0.00', outflow: '300.00', net: '-300.00' }],
  },
  financing: { inflows: '0.00', outflows: '0.00', net: '0.00', entries: [] },
  net_cash_flow: '400.00',
};

function renderCashFlow() {
  return render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <CashFlowTable cashFlow={cashFlow} loading={false} g={g} emptyLabel="No data in range" />
    </NextIntlClientProvider>,
  );
}

describe('StructuredFinancialStatement', () => {
  it('preserves income sections and subtotals in their official order without flat-table controls', () => {
    const { container } = renderStatement();
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;
    const text = desktop.textContent ?? '';

    expect(text.indexOf('Revenues')).toBeLessThan(text.indexOf('Expenses'));
    expect(text.indexOf('Total revenue')).toBeLessThan(text.indexOf('Expenses'));
    expect(within(desktop).getByText('Net income')).toBeTruthy();
    expect(within(desktop).queryByRole('button', { name: /sort|next|previous|search/i })).toBeNull();
    expect(within(desktop).getByRole('link', { name: /Sales revenue/ }).getAttribute('href')).toBe('/accounts/account-4100');
    expect(within(desktop).queryByRole('link', { name: /Total revenue|Total expense|Net income/ })).toBeNull();
  });

  it('expresses positive, negative, and zero financial tones without changing formatted values', () => {
    const { container } = renderStatement();
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;

    expect(within(desktop).getByText(/850\.00/).className).toContain('text-positive');
    const totalExpense = within(desktop).getByText('Total expense').closest('tr') as HTMLTableRowElement;
    expect(totalExpense.querySelector('td')?.className).toContain('text-negative');
    const totalRevenue = within(desktop).getByText('Total revenue').closest('tr') as HTMLTableRowElement;
    expect(totalRevenue.querySelector('td')?.textContent).toContain('1,250.00');
  });

  it('keeps the balance-sheet section hierarchy and accounting equation distinct from totals', () => {
    const sections: FinancialStatementSection[] = [
      { id: 'assets', label: 'Assets', rows: [{ id: 'asset', kind: 'detail', label: 'Cash', amount: '100.00' }, { id: 'asset-total', kind: 'subtotal', label: 'Total assets', amount: '100.00' }] },
      { id: 'liabilities', label: 'Liabilities', rows: [{ id: 'liability', kind: 'detail', label: 'Payables', amount: '40.00' }, { id: 'liability-total', kind: 'subtotal', label: 'Total liabilities', amount: '40.00' }] },
      { id: 'equity', label: 'Equity', rows: [{ id: 'equity', kind: 'detail', label: 'Capital', amount: '60.00' }, { id: 'equity-total', kind: 'subtotal', label: 'Equity and income', amount: '60.00' }] },
    ];
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <StructuredFinancialStatement
          descriptionLabel="Account"
          amountLabel="Amount"
          sections={sections}
          grandTotal={{ id: 'grand-assets', kind: 'grand-total', label: 'Total assets', amount: '100.00' }}
          equation={{ id: 'equation', kind: 'equation', label: 'Total assets = Total liabilities + Equity and income', amount: '100.00' }}
        />
      </NextIntlClientProvider>,
    );
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;
    const text = desktop.textContent ?? '';

    expect(text.indexOf('Assets')).toBeLessThan(text.indexOf('Liabilities'));
    expect(text.indexOf('Liabilities')).toBeLessThan(text.indexOf('Equity'));
    expect(within(desktop).getByText('Total assets = Total liabilities + Equity and income')).toBeTruthy();
    expect(within(desktop).queryByRole('link', { name: /Total assets =/ })).toBeNull();
  });

  it('uses a structured mobile list with logical indentation and no horizontal table as the mobile presentation', () => {
    const { container } = renderStatement({ locale: 'ar' });
    const mobile = container.querySelector('[data-testid="structured-financial-statement-mobile"]') as HTMLElement;
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;

    expect(within(mobile).getAllByRole('list')).toHaveLength(2);
    expect(within(mobile).getByText('Total revenue')).toBeTruthy();
    expect(mobile.querySelector('[class*="ps-"]')).toBeTruthy();
    expect(desktop.className).toContain('hidden');
    expect(mobile.querySelector('table')).toBeNull();
  });

  it('renders an explicit empty state inside the affected official section', () => {
    const { container } = renderStatement({ sections: [{ id: 'revenues', label: 'Revenues', rows: [{ id: 'empty', kind: 'empty', label: 'No data in range' }] }] });
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;

    expect(within(desktop).getByText('No data in range')).toBeTruthy();
  });
});

describe('CashFlowTable', () => {
  it('keeps operating, investing, and financing sections together with their subtotals and net cash without sorting or pagination', () => {
    const { container } = renderCashFlow();
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;
    const text = desktop.textContent ?? '';

    expect(text.indexOf('Operating activities')).toBeLessThan(text.indexOf('Investing activities'));
    expect(text.indexOf('Investing activities')).toBeLessThan(text.indexOf('Financing activities'));
    expect(within(desktop).getByText('Operating activities — Net cash flow')).toBeTruthy();
    expect(within(desktop).getByText('Net cash flow', { selector: 'tfoot th' })).toBeTruthy();
    expect(within(desktop).queryByRole('button', { name: /sort|next|previous|search/i })).toBeNull();
    expect(within(desktop).queryByRole('link')).toBeNull();
  });

  it('shows a loading state before cash-flow data is available', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <CashFlowTable cashFlow={null} loading g={g} emptyLabel="No data in range" />
      </NextIntlClientProvider>,
    );

    expect(container.querySelector('[data-testid="structured-financial-statement"]')).toBeNull();
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy();
  });
});
