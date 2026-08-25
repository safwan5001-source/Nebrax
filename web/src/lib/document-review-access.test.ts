import { describe, expect, it } from 'vitest';
import {
  canBuildDocumentDraft,
  canBuildPurchaseDraft,
  canViewDocumentCenter,
  linkedPurchasePresentation,
  linkedTransactionPresentation,
} from './document-review-access';

describe('Document Center sidebar access', () => {
  it('shows the entry only for an explicit view permission or an administrative fallback role', () => {
    expect(canViewDocumentCenter(['documents.center.view'], 'staff')).toBe(true);
    expect(canViewDocumentCenter([], 'staff')).toBe(false);
    expect(canViewDocumentCenter(undefined, 'owner')).toBe(true);
  });
});

describe('General document draft action access', () => {
  const readyExpense = {
    canBuildDraft: true,
    documentType: 'expense',
    status: 'ready_for_draft',
    hasLinkedTransaction: false,
  };

  it('shows Expense creation only for a ready expense with the distinct permission and no existing link', () => {
    expect(canBuildDocumentDraft(readyExpense)).toBe(true);
    expect(canBuildDocumentDraft({ ...readyExpense, canBuildDraft: false })).toBe(false);
    expect(canBuildDocumentDraft({ ...readyExpense, status: 'needs_review' })).toBe(false);
    expect(canBuildDocumentDraft({ ...readyExpense, documentType: 'sales_invoice' })).toBe(false);
    expect(canBuildDocumentDraft({ ...readyExpense, hasLinkedTransaction: true })).toBe(false);
  });

  it('retains the explicit Purchase compatibility gate for existing consumers', () => {
    const readyPurchase = {
      canBuildDraft: true,
      documentType: 'purchase_invoice',
      status: 'ready_for_draft',
      hasLinkedPurchase: false,
    };
    expect(canBuildPurchaseDraft(readyPurchase)).toBe(true);
    expect(canBuildPurchaseDraft({ ...readyPurchase, hasLinkedPurchase: true })).toBe(false);
  });
});

describe('Linked transaction presentation', () => {
  it('keeps the action and badge truthful for all draft transaction types after a state change', () => {
    expect(linkedTransactionPresentation('draft')).toEqual({ action: 'draft', badge: 'draft' });
    expect(linkedTransactionPresentation('posted')).toEqual({ action: 'posted', badge: 'posted' });
    expect(linkedTransactionPresentation('cancelled')).toEqual({ action: 'cancelled', badge: 'cancelled' });
    expect(linkedPurchasePresentation('posted')).toEqual({ action: 'posted', badge: 'posted' });
  });
});
