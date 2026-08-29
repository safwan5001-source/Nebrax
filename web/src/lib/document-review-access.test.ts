import { describe, expect, it } from 'vitest';
import {
  canBuildDocumentDraft,
  canBuildPurchaseDraft,
  canManageDocumentCenter,
  canMutateDocumentReview,
  canViewDocumentCenter,
  isDocumentReviewMutable,
  linkedPurchasePresentation,
  linkedTransactionPresentation,
  shouldShowReviewReadinessBlocker,
} from './document-review-access';

describe('Document Center sidebar access', () => {
  it('shows the entry for a normal user holding the explicit view permission', () => {
    expect(canViewDocumentCenter(['documents.center.view'], 'staff')).toBe(true);
  });

  it('hides the entry from a normal user without the permission', () => {
    expect(canViewDocumentCenter([], 'staff')).toBe(false);
    expect(canViewDocumentCenter(['invoices.view'], 'staff')).toBe(false);
  });

  // الانحدار الأصلي: `/login` يرسل `['*']` للمالك والمدير، فكان `??` يقرأ
  // `false` من `includes` ولا يسقط على الدور — فلم يرَ أي مالك الرابط قطّ.
  it('shows the entry for an owner and an admin carrying the wildcard permission', () => {
    expect(canViewDocumentCenter(['*'], 'owner')).toBe(true);
    expect(canViewDocumentCenter(['*'], 'admin')).toBe(true);
  });

  it('shows the entry for an owner and an admin when the stored permissions are missing entirely', () => {
    expect(canViewDocumentCenter(undefined, 'owner')).toBe(true);
    expect(canViewDocumentCenter(undefined, 'admin')).toBe(true);
    expect(canViewDocumentCenter(undefined, 'staff')).toBe(false);
  });

  // قائمة فارغة ليست غياباً: الخادم أجاب «لا صلاحية»، فالدور لا ينقض جوابه —
  // وإلا صار الرابط أوسع من `Rbac::allows` الذي يقرأ الجدول القابل للضبط.
  it('follows the resolved permission list over the role name when the list is present', () => {
    expect(canViewDocumentCenter([], 'owner')).toBe(false);
    expect(canViewDocumentCenter(['invoices.view'], 'admin')).toBe(false);
  });
});

describe('Document Center manage access', () => {
  it('allows intake actions only with documents.center.manage', () => {
    expect(canManageDocumentCenter(['documents.center.manage'], 'staff')).toBe(true);
    expect(canManageDocumentCenter(['documents.center.view'], 'staff')).toBe(false);
    expect(canManageDocumentCenter(['*'], 'owner')).toBe(true);
    expect(canManageDocumentCenter(undefined, 'owner')).toBe(true);
    expect(canManageDocumentCenter([], 'owner')).toBe(false);
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
