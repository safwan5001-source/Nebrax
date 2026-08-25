/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerLinesTable, type LedgerLine } from './ledger-lines-table';

afterEach(cleanup);

const labels = {
  account: 'Account',
  description: 'Description',
  costCenter: 'Cost centre',
  debit: 'Debit',
  credit: 'Credit',
  totals: 'Totals',
  unknownAccount: 'Unnamed account',
};

const lines: LedgerLine[] = [
  {
    id: 'l1', account_code: '5110', account_name: 'Cost of goods sold', description: 'Posting INV-118',
    debit: '5000.00', credit: '0.00', cost_center_code: 'CC1', cost_center_name: 'Dammam branch',
  },
  {
    id: 'l2', account_code: '1140', account_name: 'Inventory', description: null,
    debit: '0.00', credit: '5000.00',
  },
];

/** الجدول لسطح المكتب والقائمة للجوال — كلاهما في DOM معاً تحت jsdom. */
const desktop = (container: HTMLElement) => container.querySelector('.hidden.overflow-x-auto') as HTMLElement;
const mobile = (container: HTMLElement) => container.querySelector('ul') as HTMLElement;

describe('LedgerLinesTable — desktop', () => {
  it('renders one row per line with both debit and credit columns', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);

    const rows = within(desktop(container)).getAllByRole('row');
    // رأس + سطران + تذييل الإجماليات.
    expect(rows).toHaveLength(4);
  });

  it('totals debit and credit in the footer', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);

    const footer = desktop(container).querySelector('tfoot') as HTMLElement;
    expect(within(footer).getByText('Totals')).toBeTruthy();
    expect(footer.textContent).toContain('5,000.00');
  });

  it('marks an empty side with a dash rather than a zero that reads as a real amount', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);

    expect(within(desktop(container)).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the cost-centre column only when the caller asks for it', () => {
    const { container, unmount } = render(<LedgerLinesTable lines={lines} labels={labels} />);
    expect(within(desktop(container)).queryByText('Cost centre')).toBeNull();
    unmount();

    const withCentre = render(<LedgerLinesTable lines={lines} labels={labels} showCostCenter />);
    expect(within(desktop(withCentre.container)).getByText('Cost centre')).toBeTruthy();
    expect(within(desktop(withCentre.container)).getByText('CC1 — Dammam branch')).toBeTruthy();
  });
});

describe('LedgerLinesTable — mobile', () => {
  it('renders a record per line plus a totals row', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);

    expect(within(mobile(container)).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows only the side each line actually carries, labelled in words', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);
    const [debitLine, creditLine] = within(mobile(container)).getAllByRole('listitem');

    expect(within(debitLine).getByText('Debit')).toBeTruthy();
    expect(within(debitLine).queryByText('Credit')).toBeNull();
    expect(within(creditLine).getByText('Credit')).toBeTruthy();
    expect(within(creditLine).queryByText('Debit')).toBeNull();
  });

  it('keeps the account first, then the description', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);
    const first = within(mobile(container)).getAllByRole('listitem')[0];

    const text = first.textContent ?? '';
    expect(text.indexOf('Cost of goods sold')).toBeLessThan(text.indexOf('Posting INV-118'));
  });

  it('falls back to a named placeholder when the account has no name', () => {
    const { container } = render(
      <LedgerLinesTable
        lines={[{ id: 'l3', account_code: '9999', account_name: null, debit: '10.00', credit: '0.00' }]}
        labels={labels}
      />
    );

    expect(within(mobile(container)).getByText(/Unnamed account/)).toBeTruthy();
  });

  it('renders no line records at all for an empty entry, but still shows the totals row', () => {
    const { container } = render(<LedgerLinesTable lines={[]} labels={labels} />);

    expect(within(mobile(container)).getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('LedgerLinesTable — money presentation', () => {
  it('renders amounts through the shared formatter in Mono, never a hardcoded currency word', () => {
    const { container } = render(<LedgerLinesTable lines={lines} labels={labels} />);

    expect(container.textContent).not.toMatch(/SAR|ريال|ر\.س/);
    const amount = within(mobile(container)).getAllByText(/5,000\.00/)[0];
    expect(amount.className).toContain('num');
  });
});
