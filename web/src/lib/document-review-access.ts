export function canViewDocumentCenter(permissions?: string[], role?: string): boolean {
  return permissions?.includes('documents.center.view') ?? ['owner', 'admin'].includes(role ?? '');
}

export function canBuildPurchaseDraft(input: {
  canBuildDraft: boolean;
  documentType: string;
  status: string;
  hasPurchaseDraft: boolean;
}): boolean {
  return input.canBuildDraft
    && input.documentType === 'purchase_invoice'
    && input.status === 'ready_for_draft'
    && !input.hasPurchaseDraft;
}
