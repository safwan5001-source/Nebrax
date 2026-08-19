import type { DocumentTypeId } from '@/modules/documents/types';
import type { AssignmentScope, AssignmentUsage } from './print-template-assignment-contract';

export interface AssignmentResolutionItem {
  id: string;
  branch_id: string | null;
  document_type: DocumentTypeId;
  usage: AssignmentUsage;
  print_template_revision_id: string;
}

export interface AssignmentResolution {
  /** التعيين المطابق للنطاق الذي سيستبدله الحفظ، إن وُجد. */
  target: AssignmentResolutionItem | null;
  /** التعيين الذي سيستخدمه المستند الآن قبل أي حفظ. */
  effective: AssignmentResolutionItem | null;
  /** افتراضي المؤسسة الذي يرثه الفرع إن لم يملك تجاوزاً صريحاً. */
  companyFallback: AssignmentResolutionItem | null;
}

/**
 * يكرر عرض الواجهة أولوية الخادم فقط: تجاوز الفرع أولاً، ثم افتراضي المؤسسة.
 * لا ينشئ هذا المحول تعييناً ولا يقرر صلاحية المراجعة؛ وظيفته أن يقول الحقيقة
 * قبل الحفظ عن الأثر المتوقع لمسار upsert الخلفي.
 */
export function resolveAssignmentContext(input: {
  assignments: readonly AssignmentResolutionItem[];
  scope: AssignmentScope;
  branchId: string;
  documentType: DocumentTypeId;
  usage: AssignmentUsage;
}): AssignmentResolution {
  const matching = input.assignments.filter((assignment) => (
    assignment.document_type === input.documentType && assignment.usage === input.usage
  ));
  const companyFallback = matching.find((assignment) => assignment.branch_id === null) ?? null;

  if (input.scope === 'company') {
    return {
      target: companyFallback,
      effective: companyFallback,
      companyFallback,
    };
  }

  const branchOverride = input.branchId
    ? matching.find((assignment) => assignment.branch_id === input.branchId) ?? null
    : null;

  return {
    target: branchOverride,
    effective: branchOverride ?? companyFallback,
    companyFallback,
  };
}
