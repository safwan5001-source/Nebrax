import { describe, expect, it } from 'vitest';
import {
  canBuildDocumentDraft,
  canBuildPurchaseDraft,
  canMutateDocumentReview,
  canViewDocumentCenter,
  isDocumentReviewMutable,
  linkedPurchasePresentation,
  linkedTransactionPresentation,
  shouldShowReviewReadinessBlocker,
} from './document-review-access';

describe('Document Center sidebar access', () => {
  it('shows the entry only for an explicit view permission or an administrative fallback role', () => {
    expect(canViewDocumentCenter(['documents.center.view'], 'staff')).toBe(true);
    expect(canViewDocumentCenter([], 'staff')).toBe(false);
    expect(canViewDocumentCenter(undefined, 'owner')).toBe(true);
  });
});

describe('Document review workflow mutability', () => {
  it('allows review mutations only while the batch is in needs_review and the reviewer is authorized', () => {
    expect(isDocumentReviewMutable('needs_review')).toBe(true);
    expect(canMutateDocumentReview({ canReview: true, status: 'needs_review' })).toBe(true);
    expect(canMutateDocumentReview({ canReview: false, status: 'needs_review' })).toBe(false);
  });

  it('keeps ready_for_draft and draft_created read-only even for a reviewer', () => {
    expect(isDocumentReviewMutable('ready_for_draft')).toBe(false);
    expect(isDocumentReviewMutable('draft_created')).toBe(false);
    expect(canMutateDocumentReview({ canReview: true, status: 'ready_for_draft' })).toBe(false);
    expect(canMutateDocumentReview({ canReview: true, status: 'draft_created' })).toBe(false);
  });

  it('shows the readiness blocker only for a mutable review that is not completable', () => {
    expect(shouldShowReviewReadinessBlocker({ isReviewMutable: true, canComplete: false })).toBe(true);
    expect(shouldShowReviewReadinessBlocker({ isReviewMutable: true, canComplete: true })).toBe(false);
    expect(shouldShowReviewReadinessBlocker({ isReviewMutable: false, canComplete: false })).toBe(false);
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
