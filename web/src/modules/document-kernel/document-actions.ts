import type { PrintableFamily } from '@/modules/document-families/types';

/**
 * لا يقرر هذا الملف صلاحية المستخدم أو حالة المصدر؛ ذلك قرار خادم محميّ بـRBAC
 * والخدمات. الواجهة تستهلك الوصف فقط كي لا تعد المستخدم بإجراء سيرفض لاحقاً.
 */
export const DOCUMENT_ACTION_IDS = [
  'create',
  'edit',
  'issue',
  'confirm',
  'reverse',
  'print',
  'pdf',
  'share',
  'xlsx',
  'csv',
  'ledger',
  'template',
  'export_profile',
] as const;

export type DocumentActionId = (typeof DOCUMENT_ACTION_IDS)[number];

export type DocumentActionCapabilities = Readonly<Record<DocumentActionId, boolean>>;

export type DocumentLifecycle = 'operational' | 'derived';

export interface UiDocumentDescriptor {
  family: PrintableFamily;
  kind: string;
  lifecycle: DocumentLifecycle;
  /** فارغة للمخرجات المشتقة، ومن API للمصادر التشغيلية فقط. */
  status: string | null;
  capabilities: DocumentActionCapabilities;
}

const OPERATIONAL_FAMILIES: readonly PrintableFamily[] = ['line_item', 'voucher'];
const DERIVED_FAMILIES: readonly PrintableFamily[] = ['account_statement', 'tabular_report'];
const DERIVED_FORBIDDEN_ACTIONS: readonly DocumentActionId[] = [
  'create',
  'edit',
  'issue',
  'confirm',
  'reverse',
  'template',
];

/** قائمة ثابتة قابلة للاستخدام في مكوّنات الأفعال من دون تكرار شروط النوع والحالة. */
export function availableDocumentActions(descriptor: UiDocumentDescriptor): readonly DocumentActionId[] {
  return DOCUMENT_ACTION_IDS.filter((action) => descriptor.capabilities[action]);
}

export function canDocumentAction(descriptor: UiDocumentDescriptor, action: DocumentActionId): boolean {
  return descriptor.capabilities[action];
}

/**
 * يتحقق من اتساق وصف القدرة الذي يصل من الخادم قبل أن يبني عليه مكوّن الواجهة.
 * لا يستبدل هذا التحقق تفويض الخادم؛ هو حارس واجهة/عقد ضد رد API متناقض.
 */
export function validateUiDocumentDescriptor(descriptor: UiDocumentDescriptor): readonly string[] {
  const errors: string[] = [];
  const operationalFamily = OPERATIONAL_FAMILIES.includes(descriptor.family);
  const derivedFamily = DERIVED_FAMILIES.includes(descriptor.family);

  if (!operationalFamily && !derivedFamily) errors.push(`unsupported_family:${descriptor.family}`);
  if (operationalFamily && descriptor.lifecycle !== 'operational') errors.push('operational_family_requires_operational_lifecycle');
  if (derivedFamily && descriptor.lifecycle !== 'derived') errors.push('derived_family_requires_derived_lifecycle');
  if (descriptor.lifecycle === 'operational' && !descriptor.status) errors.push('operational_document_requires_status');
  if (descriptor.lifecycle === 'derived' && descriptor.status !== null) errors.push('derived_document_must_not_have_status');

  if (derivedFamily) {
    for (const action of DERIVED_FORBIDDEN_ACTIONS) {
      if (descriptor.capabilities[action]) errors.push(`derived_document_forbids_action:${action}`);
    }
  }

  return errors;
}
