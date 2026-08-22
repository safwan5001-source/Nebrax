import {
  validateDocumentLayout,
  validateDocumentTypeFamily,
  type DocumentLayoutValidationResult,
} from '@/modules/documents/registry/document-types';
import type { DocSectionLayoutItem, DocumentTypeId } from '@/modules/documents/types';

/** حالة تحميل بيانات المركز؛ تبقى بيانات المعاينة منفصلة عن هذه الحالة. */
export type TemplateCenterLoadState = 'loading' | 'ready' | 'empty' | 'error';

/** لا يفتح المستخدم نوعاً قبل معرفة القوالب، ولا يحاول الإنشاء من شاشة خطأ. */
export function canOpenTemplateCenterDocumentType(state: TemplateCenterLoadState): boolean {
  return state === 'ready' || state === 'empty';
}

/**
 * يحترم نوع المستند الذي دخل منه المستخدم ما دام القالب يدعمه، وإلا يعود إلى
 * النوع الأول للقالب للحفاظ على قابلية فتح القوالب من المكتبة مباشرةً.
 */
export function resolveActiveDocumentType(
  documentTypes: readonly DocumentTypeId[],
  requestedType: DocumentTypeId | null,
): DocumentTypeId {
  if (requestedType !== null && documentTypes.includes(requestedType)) {
    return requestedType;
  }

  return documentTypes[0] ?? 'tax_invoice';
}

/**
 * الحفظ لا يختزل قالباً متعدد الأنواع إلى نوع المعاينة الحالي. مراجعة القالب
 * هي مصدر الحقيقة إن وجد عقدها، وإلا نرث عقد رأس القالب المحلي.
 */
export function documentTypesForDraftSave(
  revisionDocumentTypes: readonly DocumentTypeId[],
  templateDocumentTypes: readonly DocumentTypeId[],
): DocumentTypeId[] {
  const source = revisionDocumentTypes.length ? revisionDocumentTypes : templateDocumentTypes;
  return [...source];
}

/**
 * يطابق تحقق العميل عقد الخادم: تخطيط القالب المشترك يجب أن يصلح لكل نوعٍ
 * مسجل في مراجعته، لا لنوع المعاينة النشط وحده.
 */
export function validateLayoutForDocumentTypes(
  documentTypes: readonly DocumentTypeId[],
  layout: readonly DocSectionLayoutItem[],
): DocumentLayoutValidationResult {
  const familyValidation = validateDocumentTypeFamily(documentTypes);
  if (!familyValidation.valid) return familyValidation;

  const errors = [...new Set(documentTypes.flatMap((type) => validateDocumentLayout(type, layout).errors))];
  return { valid: errors.length === 0, errors };
}
