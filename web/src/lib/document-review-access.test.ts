import { describe, expect, it } from 'vitest';
import { canBuildPurchaseDraft, canViewDocumentCenter } from './document-review-access';

describe('Document Center sidebar access', () => {
  it('shows the entry only for an explicit view permission or an administrative fallback role', () => {
    expect(canViewDocumentCenter(['documents.center.view'], 'staff')).toBe(true);
    expect(canViewDocumentCenter([], 'staff')).toBe(false);
    expect(canViewDocumentCenter(undefined, 'owner')).toBe(true);
  });
});

describe('Purchase draft action access', () => {
  const readyPurchase = {
    canBuildDraft: true,
    documentType: 'purchase_invoice',
    status: 'ready_for_draft',
    hasPurchaseDraft: false,
  };

  it('shows the creation action only for a ready purchase invoice with the distinct permission', () => {
    expect(canBuildPurchaseDraft(readyPurchase)).toBe(true);
    expect(canBuildPurchaseDraft({ ...readyPurchase, canBuildDraft: false })).toBe(false);
    expect(canBuildPurchaseDraft({ ...readyPurchase, status: 'needs_review' })).toBe(false);
    expect(canBuildPurchaseDraft({ ...readyPurchase, documentType: 'sales_invoice' })).toBe(false);
    expect(canBuildPurchaseDraft({ ...readyPurchase, hasPurchaseDraft: true })).toBe(false);
  });
});
