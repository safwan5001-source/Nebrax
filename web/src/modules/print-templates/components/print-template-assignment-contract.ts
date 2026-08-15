import type { DocumentTypeId } from '@/modules/documents/types';

export const ASSIGNMENT_DOCUMENT_TYPES: readonly DocumentTypeId[] = [
  'tax_invoice', 'simplified_tax_invoice', 'quotation', 'proforma_invoice',
  'sales_order', 'purchase_order', 'purchase_invoice', 'delivery_note',
  'packing_list', 'receipt_voucher', 'payment_voucher', 'credit_note',
  'debit_note', 'statement_of_account',
];

export const ASSIGNMENT_USAGES = ['print', 'pdf', 'thermal'] as const;
export type AssignmentUsage = (typeof ASSIGNMENT_USAGES)[number];
export type AssignmentScope = 'company' | 'branch';

/**
 * يحافظ هذا المحول على معنى النطاق في كل استدعاء API: `null` افتراضي مؤسسة،
 * وقيمة UUID تجاوز فرع صريح. لا يقرر الصلاحية أو أولوية الحل؛ الخادم هو مصدرها.
 */
export function buildPrintTemplateAssignmentPayload(input: {
  scope: AssignmentScope;
  branchId: string;
  documentType: DocumentTypeId;
  usage: AssignmentUsage;
  revisionId: string;
}) {
  return {
    branch_id: input.scope === 'branch' ? input.branchId : null,
    document_type: input.documentType,
    usage: input.usage,
    print_template_revision_id: input.revisionId,
  };
}
