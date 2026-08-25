import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { useTranslations } from 'next-intl';
import { JournalTable } from './general-advanced-reports-workspace';

afterEach(cleanup);

const generalLabels: Record<string, string> = {
  journalEntries: 'Journal entries',
  date: 'Date',
  entryNumber: 'Entry number',
  description: 'Description',
  debit: 'Debit',
  credit: 'Credit',
};

const g = ((key: string) => generalLabels[key] ?? key) as ReturnType<typeof useTranslations>;
const t = ((key: string) => ({ total: 'Total', empty: 'No entries' }[key] ?? key)) as ReturnType<typeof useTranslations>;

const journal = {
  total_debit: '200.00',
  total_credit: '200.00',
  rows: [
    {
      entry_id: 'entry-1',
      date: '2026-08-01',
      number: 'JV-001',
      description: 'First journal entry',
      debit: '100.00',
      credit: '100.00',
      lines: [
        { account_id: 'a1', account_code: '1100', account_name: 'Cash', description: null, debit: '100.00', credit: '0.00' },
        { account_id: 'a2', account_code: '4100', account_name: 'Revenue', description: null, debit: '0.00', credit: '100.00' },
      ],
    },
    {
      entry_id: 'entry-2',
      date: '2026-08-02',
      number: 'JV-002',
      description: 'Second journal entry',
      debit: '100.00',
      credit: '100.00',
      lines: [
        { account_id: 'a3', account_code: '1200', account_name: 'Receivable', description: null, debit: '100.00', credit: '0.00' },
        { account_id: 'a4', account_code: '2110', account_name: 'Payable', description: null, debit: '0.00', credit: '100.00' },
      ],
    },
  ],
};

describe('JournalTable', () => {
  it('keeps all lines of each journal entry inside a dedicated desktop row group without table sorting or pagination controls', () => {
    const { container } = render(<JournalTable journal={journal} loading={false} g={g} t={t} />);

    const desktopTable = within(container.querySelector('.md\\:block') as HTMLElement).getByRole('table');
    const entryBodies = desktopTable.querySelectorAll('tbody');

    expect(entryBodies).toHaveLength(2);
    expect(within(entryBodies[0]).getAllByRole('row')).toHaveLength(2);
    expect(within(entryBodies[0]).getByText('JV-001')).toBeTruthy();
    expect(within(entryBodies[0]).getByText(/Cash/)).toBeTruthy();
    expect(within(entryBodies[0]).getByText(/Revenue/)).toBeTruthy();
    expect(within(entryBodies[1]).getByText('JV-002')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /search|sort|next|previous/i })).toBeNull();
  });

  it('preserves each journal entry as one mobile article and retains official report totals', () => {
    const { container } = render(<JournalTable journal={journal} loading={false} g={g} t={t} />);

    const mobileRows = container.querySelector('.md\\:hidden') as HTMLElement;
    const entryCards = mobileRows.querySelectorAll('article');

    expect(entryCards).toHaveLength(3);
    expect(within(entryCards[0]).getByText('JV-001')).toBeTruthy();
    expect(within(entryCards[0]).getByText(/Cash/)).toBeTruthy();
    expect(within(entryCards[0]).getByText(/Revenue/)).toBeTruthy();
    expect(within(entryCards[1]).getByText('JV-002')).toBeTruthy();
    expect(within(entryCards[2]).getByText('Total')).toBeTruthy();
    expect(within(entryCards[2]).getAllByText(/200\.00/)).toHaveLength(2);
  });
});
