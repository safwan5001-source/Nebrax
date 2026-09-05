import type { WorkflowStatusGroup } from '@/modules/document-center/intake-contract';

export function statusTranslationKey(status: string): string {
  const map: Record<string, string> = {
    draft: 'statusDraft',
    receiving: 'statusReceiving',
    received: 'statusReceived',
    queued: 'statusQueued',
    processing: 'statusProcessing',
    needs_review: 'statusNeedsReview',
    reviewed: 'statusReviewed',
    ready_for_draft: 'statusReadyForDraft',
    creating_draft: 'statusCreatingDraft',
    draft_created: 'statusDraftCreated',
    archived: 'statusArchived',
    failed: 'statusFailed',
    quarantined: 'statusQuarantined',
    duplicate: 'statusDuplicate',
    cancelled: 'statusCancelled',
  };
  return map[status] ?? 'statusReceived';
}

export function documentTypeTranslationKey(documentType: string): string {
  const map: Record<string, string> = {
    purchase_invoice: 'typePurchaseInvoice',
    sales_invoice: 'typeSalesInvoice',
    expense: 'typeExpense',
    delivery_note: 'typeDeliveryNote',
    receipt: 'typeReceipt',
    credit_note: 'typeCreditNote',
    debit_note: 'typeDebitNote',
  };
  return map[documentType] ?? documentType;
}

export function sourceTypeTranslationKey(sourceType: string): string {
  if (sourceType === 'web') return 'sourceWeb';
  return 'sourceManual';
}

export function statusBadgeTone(status: string): 'positive' | 'warning' | 'negative' | 'muted' {
  if (status === 'ready_for_draft' || status === 'draft_created' || status === 'reviewed') return 'positive';
  if (status === 'needs_review' || status === 'processing' || status === 'queued' || status === 'received' || status === 'receiving') return 'warning';
  if (status === 'failed' || status === 'quarantined') return 'negative';
  if (status === 'cancelled' || status === 'duplicate' || status === 'archived') return 'muted';
  return 'warning';
}

export const STATUS_GROUP_OPTIONS: { value: '' | WorkflowStatusGroup; labelKey: string }[] = [
  { value: '', labelKey: 'statusGroupAll' },
  { value: 'inbox', labelKey: 'statusGroupInbox' },
  { value: 'review', labelKey: 'statusGroupReview' },
  { value: 'ready', labelKey: 'statusGroupReady' },
  { value: 'completed', labelKey: 'statusGroupCompleted' },
  { value: 'terminal', labelKey: 'statusGroupTerminal' },
];
