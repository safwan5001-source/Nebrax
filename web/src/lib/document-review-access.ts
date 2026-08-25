export type LinkedTransaction = {
  link_id: string;
  transaction_type: 'purchase' | 'expense';
  transaction_id: string;
  transaction_number: string;
  status: string;
  url: string;
};

export function canViewDocumentCenter(permissions?: string[], role?: string): boolean {
  return permissions?.includes('documents.center.view') ?? ['owner', 'admin'].includes(role ?? '');
}

export function canBuildDocumentDraft(input: {
  canBuildDraft: boolean;
  documentType: string;
  status: string;
  hasLinkedTransaction: boolean;
}): boolean {
  return input.canBuildDraft
    && ['purchase_invoice', 'expense'].includes(input.documentType)
    && input.status === 'ready_for_draft'
    && !input.hasLinkedTransaction;
}

export function linkedTransactionPresentation(status: string): {
  action: 'draft' | 'posted' | 'cancelled';
  badge: 'draft' | 'posted' | 'cancelled';
} {
  if (status === 'posted') return { action: 'posted', badge: 'posted' };
  if (status === 'cancelled') return { action: 'cancelled', badge: 'cancelled' };

  return { action: 'draft', badge: 'draft' };
}

/** توافق صريح مع أي مستهلك PR-7 لم يُعمّم بعد. */
export const canBuildPurchaseDraft = (input: {
  canBuildDraft: boolean;
  documentType: string;
  status: string;
  hasLinkedPurchase: boolean;
}): boolean => canBuildDocumentDraft({
  canBuildDraft: input.canBuildDraft,
  documentType: input.documentType,
  status: input.status,
  hasLinkedTransaction: input.hasLinkedPurchase,
});

/** توافق صريح مع أي تسمية Purchase باقية. */
export const linkedPurchasePresentation = linkedTransactionPresentation;
