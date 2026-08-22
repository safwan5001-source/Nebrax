import { describe, expect, it } from 'vitest';
import { buildAccountStatementDocument } from './from-partner-statement';

describe('Account statement family builder', () => {
  it('preserves source balances and keeps absent audit references explicit', () => {
    const document = buildAccountStatementDocument({
      statement: {
        partner: { id: 'partner-1', name: 'شركة الندى', type: 'customer' },
        opening_balance: '500.00',
        rows: [{
          date: '2026-08-22',
          number: 'JE-00412',
          description: 'فاتورة INV-1024',
          debit: '1,150.00',
          credit: '0.00',
          balance: '1,650.00',
        }],
        closing_balance: '1,650.00',
      },
      company: { name: 'نبراس', vat_number: '310122334400003', currency: 'SAR' },
      filters: { from: '2026-08-01', to: '2026-08-31', branchIds: ['branch-1'] },
      generatedAt: '2026-08-22T09:00:00.000Z',
    });

    expect(document.family).toBe('account_statement');
    expect(document.openingBalance).toBe('500.00');
    expect(document.closingBalance).toBe('1,650.00');
    expect(document.periodDebit).toBeNull();
    expect(document.entries[0]).toMatchObject({
      journalNumber: 'JE-00412',
      journalEntryId: null,
      sourceType: null,
      sourceId: null,
      debit: '1,150.00',
      balance: '1,650.00',
    });
  });
});
