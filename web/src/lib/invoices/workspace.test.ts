import { describe, expect, it } from 'vitest';
import { hasActiveInvoiceQuery, isInvoiceDraft, isInvoiceOverdue, todayIsoDate } from './workspace';

describe('invoice workspace presentation rules', () => {
  it('treats only draft invoices as editable drafts', () => {
    expect(isInvoiceDraft('draft')).toBe(true);
    expect(isInvoiceDraft('posted')).toBe(false);
    expect(isInvoiceDraft('cancelled')).toBe(false);
  });

  it('formats today as a Gregorian ISO calendar date', () => {
    expect(todayIsoDate(new Date(2026, 8, 3))).toBe('2026-09-03');
  });

  it('marks a posted invoice overdue only when remaining is positive and due date has passed', () => {
    expect(isInvoiceOverdue({
      status: 'posted',
      remaining: '150.00',
      due_date: '2026-08-01',
    }, '2026-09-03')).toBe(true);
  });

  it('does not invent overdue for drafts, cancelled invoices, paid invoices, missing dates, or due today', () => {
    const today = '2026-09-03';
    expect(isInvoiceOverdue({ status: 'draft', remaining: '150.00', due_date: '2026-08-01' }, today)).toBe(false);
    expect(isInvoiceOverdue({ status: 'cancelled', remaining: '150.00', due_date: '2026-08-01' }, today)).toBe(false);
    expect(isInvoiceOverdue({ status: 'posted', remaining: '0.00', due_date: '2026-08-01' }, today)).toBe(false);
    expect(isInvoiceOverdue({ status: 'posted', remaining: '150.00', due_date: null }, today)).toBe(false);
    expect(isInvoiceOverdue({ status: 'posted', remaining: '150.00', due_date: today }, today)).toBe(false);
  });

  it('distinguishes a filtered query from an empty tenant list', () => {
    expect(hasActiveInvoiceQuery('', [])).toBe(false);
    expect(hasActiveInvoiceQuery('  INV  ', [])).toBe(true);
    expect(hasActiveInvoiceQuery('', [{ key: 'status' }])).toBe(true);
  });
});
