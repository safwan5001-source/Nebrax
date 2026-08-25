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
  inflows: 'Inflows',
  outflows: 'Outflows',
  empty: 'No data in range',
};
const g = ((key: string) => generalLabels[key] ?? key) as ReturnType<typeof useTranslations>;
const t = ((key: string) => ({
  current_amount: 'Current', comparison_amount: 'Comparison', variance: 'Variance', variance_percent: 'Variance %', comparison: 'Comparison',
}[key] ?? key)) as ReturnType<typeof useTranslations>;

const comparisonCashFlow = {
  operating: { inflows: '600.00', outflows: '100.00', net: '500.00', entries: [{ date: '2026-07-02', number: 'JV-099', description: 'Previous cash sale', inflow: '600.00', outflow: '0.00', net: '600.00' }] },
  investing: { inflows: '0.00', outflows: '100.00', net: '-100.00', entries: [] },
  financing: { inflows: '0.00', outflows: '0.00', net: '0.00', entries: [] },
  net_cash_flow: '400.00',
};

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
      <CashFlowTable cashFlow={cashFlow} comparisonCashFlow={null} loading={false} g={g} t={t} emptyLabel="No data in range" />
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

    expect(within(desktop).getByText(/850\.00/).closest('td')?.className).toContain('text-positive');
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
          equation={{ id: 'equation', kind: 'equation', label: 'Total assets = Total liabilities + Equity and income', amount: '100.00' }}
        />
      </NextIntlClientProvider>,
    );
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;
    const text = desktop.textContent ?? '';

    expect(text.indexOf('Assets')).toBeLessThan(text.indexOf('Liabilities'));
    expect(text.indexOf('Liabilities')).toBeLessThan(text.indexOf('Equity'));
    const footer = desktop.querySelector('tfoot') as HTMLElement;
    expect(within(desktop).getAllByText('Total assets', { exact: true })).toHaveLength(1);
    expect(within(footer).getByText('Total assets = Total liabilities + Equity and income')).toBeTruthy();
    expect(footer.querySelectorAll('tr')).toHaveLength(1);
    expect(within(desktop).getByText('Total liabilities')).toBeTruthy();
    expect(within(desktop).getByText('Equity and income')).toBeTruthy();
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
  it('keeps operating, investing, and financing sections together while preserving every cash-flow value without sorting or pagination', () => {
    const { container } = renderCashFlow();
    const desktop = container.querySelector('[data-testid="structured-financial-statement-desktop"]') as HTMLElement;
    const text = desktop.textContent ?? '';
    const cashSale = within(desktop).getByText('Cash sale').closest('tr') as HTMLTableRowElement;
    const assetPurchase = within(desktop).getByText('Asset purchase').closest('tr') as HTMLTableRowElement;
    const operatingSubtotal = within(desktop).getByText('Operating activities — Net cash flow').closest('tr') as HTMLTableRowElement;
    const investingSubtotal = within(desktop).getByText('Investing activities — Net cash flow').closest('tr') as HTMLTableRowElement;
    const financingSubtotal = within(desktop).getByText('Financing activities — Net cash flow').closest('tr') as HTMLTableRowElement;

    expect(text.indexOf('Operating activities')).toBeLessThan(text.indexOf('Investing activities'));
    expect(text.indexOf('Investing activities')).toBeLessThan(text.indexOf('Financing activities'));
    expect(within(desktop).getByText('Inflows')).toBeTruthy();
    expect(within(desktop).getByText('Outflows')).toBeTruthy();
    expect(cashSale.textContent).toContain('2026-08-01 · JV-001');
    expect(cashSale.textContent).toContain('900.00');
    expect(cashSale.textContent).toContain('0.00');
    expect(assetPurchase.textContent).toContain('300.00');
    expect(assetPurchase.textContent).toContain('-300.00');
    expect(operatingSubtotal.textContent).toContain('900.00');
    expect(operatingSubtotal.textContent).toContain('200.00');
    expect(operatingSubtotal.textContent).toContain('700.00');
    expect(investingSubtotal.textContent).toContain('0.00');
    expect(investingSubtotal.textContent).toContain('300.00');
    expect(investingSubtotal.textContent).toContain('-300.00');
    expect(financingSubtotal.textContent).toContain('0.00');
    expect(within(desktop).getAllByText('Net cash flow', { selector: 'tfoot th' })).toHaveLength(1);
    expect(within(desktop).queryByRole('button', { name: /sort|next|previous|search/i })).toBeNull();
    expect(within(desktop).queryByRole('link')).toBeNull();
  });

  it('keeps current transactions unblended while presenting only comparative section summaries and the grand net cash flow', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <CashFlowTable cashFlow={cashFlow} comparisonCashFlow={comparisonCashFlow} loading={false} g={g} t={t} emptyLabel="No data in range" />
      </NextIntlClientProvider>,
    );
    const statements = container.querySelectorAll('[data-testid="structured-financial-statement-desktop"]');
    const details = statements[0] as HTMLElement;
    const summary = statements[1] as HTMLElement;

    expect(within(details).getByText('Cash sale')).toBeTruthy();
    expect(within(details).queryByText('Previous cash sale')).toBeNull();
    expect(within(details).queryByText('Operating activities — Net cash flow')).toBeNull();
    expect(within(summary).getByText('Operating activities — Net cash flow')).toBeTruthy();
    expect(within(summary).getByText('Net cash flow', { selector: 'tfoot th' })).toBeTruthy();
    expect(within(summary).getByText('Current')).toBeTruthy();
    expect(within(summary).getByRole('columnheader', { name: 'Comparison' })).toBeTruthy();
    expect(within(summary).getByText('Variance')).toBeTruthy();
  });

  it('presents each cash-flow movement and section subtotal as an organised three-value mobile grid', () => {
    const { container } = renderCashFlow();
    const mobile = container.querySelector('[data-testid="structured-financial-statement-mobile"]') as HTMLElement;
    const cashSale = within(mobile).getByText('Cash sale').closest('li') as HTMLLIElement;
    const operatingSubtotal = within(mobile).getByText('Operating activities — Net cash flow').closest('li') as HTMLLIElement;

    expect(cashSale.textContent).toContain('2026-08-01 · JV-001');
    expect(cashSale.textContent).toContain('Inflows');
    expect(cashSale.textContent).toContain('Outflows');
    expect(cashSale.textContent).toContain('Net cash flow');
    expect(cashSale.textContent).toContain('900.00');
    expect(cashSale.textContent).toContain('0.00');
    expect(operatingSubtotal.textContent).toContain('900.00');
    expect(operatingSubtotal.textContent).toContain('200.00');
    expect(operatingSubtotal.textContent).toContain('700.00');
    expect(mobile.querySelector('table')).toBeNull();
  });

  it('shows a loading state before cash-flow data is available', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <CashFlowTable cashFlow={null} comparisonCashFlow={null} loading g={g} t={t} emptyLabel="No data in range" />
      </NextIntlClientProvider>,
    );

    expect(container.querySelector('[data-testid="structured-financial-statement"]')).toBeNull();
    expect(container.querySelector('[class*="animate-pulse"]')).toBeTruthy();
  });
});
