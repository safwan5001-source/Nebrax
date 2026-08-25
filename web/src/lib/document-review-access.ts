export function canViewDocumentCenter(permissions?: string[], role?: string): boolean {
  return permissions?.includes('documents.center.view') ?? ['owner', 'admin'].includes(role ?? '');
}

export function canBuildPurchaseDraft(input: {
  canBuildDraft: boolean;
  documentType: string;
  status: string;
  hasLinkedPurchase: boolean;
}): boolean {
  return input.canBuildDraft
    && input.documentType === 'purchase_invoice'
    && input.status === 'ready_for_draft'
    && !input.hasLinkedPurchase;
}

export function linkedPurchasePresentation(status: string): {
  action: 'draft' | 'posted' | 'cancelled';
  badge: 'draft' | 'posted' | 'cancelled';
} {
  if (status === 'posted') return { action: 'posted', badge: 'posted' };
  if (status === 'cancelled') return { action: 'cancelled', badge: 'cancelled' };

  return { action: 'draft', badge: 'draft' };
}
