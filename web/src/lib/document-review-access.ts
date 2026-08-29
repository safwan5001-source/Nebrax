import { hasPermission } from '@/lib/permissions';

export type LinkedTransaction = {
  link_id: string;
  transaction_type: 'purchase' | 'expense';
  transaction_id: string;
  transaction_number: string;
  status: string;
  url: string;
};

/** لا تقبل خدمة المراجعة أي طفرة خارج مرحلة المراجعة الفعلية. */
export function isDocumentReviewMutable(status: string): boolean {
  return status === 'needs_review';
}

export function canMutateDocumentReview(input: { canReview: boolean; status: string }): boolean {
  return input.canReview && isDocumentReviewMutable(input.status);
}

/** يظهر تنبيه الجاهزية فقط عندما تكون المراجعة ما زالت مرحلةً قابلة للتعديل ومحصورةً بعائق. */
export function shouldShowReviewReadinessBlocker(input: { isReviewMutable: boolean; canComplete: boolean }): boolean {
  return input.isReviewMutable && !input.canComplete;
}

/**
 * ظهور مركز المستندات في التنقل = صلاحية العرض وحدها. أما الاستحقاق التجاري
 * وحالة التطبيق فيحسمهما الخادم في `GET /applications/nav-state` ولا تُحسب هنا.
 */
export function canViewDocumentCenter(permissions?: string[], role?: string): boolean {
  return hasPermission(permissions, role, 'documents.center.view');
}

/** إنشاء حزمة ورفع ملفات يتطلب صلاحية الإدارة — لا يكفي العرض. */
export function canManageDocumentCenter(permissions?: string[], role?: string): boolean {
  return hasPermission(permissions, role, 'documents.center.manage');
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
