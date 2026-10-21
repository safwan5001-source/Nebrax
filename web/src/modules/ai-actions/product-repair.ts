// AI-ACTIONS-06B — عقد إصلاح الصفوف الفاشلة. الإصلاح عملية جديدة تضم الصفوف الفاشلة وحدها؛
// الخادم يحدّد الصفوف القابلة للإصلاح والحقول المرتبطة بالفشل، والواجهة تعرضها وتقيّد التعديل بها.
import type { Lang } from './product-execution';

export interface RepairFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RepairCandidate {
  row_id: string;
  source_row: number;
  kind: 'row' | 'images';
  operation: 'create' | 'update' | 'skip';
  display: { name: string | null; sku: string | null; barcode: string | null } | null;
  failure: RepairFailure;
  affected_fields: string[];
  scope: 'fields' | 'all' | 'none';
}

export interface RepairPlan {
  rows: RepairCandidate[];
  retry_pending: number;
  open_repair: { action_id: string; status: string } | null;
  reason: string | null;
}

export interface RepairInfo {
  repair_id: string;
  action_id: string;
  origin: { action_id: string; execution_id: string; status: string | null };
  rows: (Omit<RepairCandidate, 'operation' | 'display'> & { origin_operation: string; display: RepairCandidate['display'] })[];
}

export const repairHref = (actionId: string): string => `/products/ai-import?action=${encodeURIComponent(actionId)}`;

/** هل يجوز تعديل هذا الحقل في صف إصلاح؟ خارج الإصلاح لا قيد. */
export function fieldEditable(repair: RepairInfo | null, rowId: string, field: string): boolean {
  if (repair === null) return true;
  return repair.rows.find((row) => row.row_id === rowId)?.affected_fields.includes(field) === true;
}

const TEXT = {
  ar: {
    button: 'إصلاح وإعادة المحاولة',
    resume: 'متابعة الإصلاح المفتوح',
    working: 'جارٍ إنشاء الإصلاح…',
    summary: (n: number) => `${n} صفاً يحتاج إصلاحاً — لا تعالجه «إعادة المحاولة».`,
    retryFirst: 'الصفوف الفاشلة المتبقية قابلة لإعادة المحاولة بالموافقة الحالية؛ استخدم «إعادة المحاولة».',
    confirmTitle: 'إنشاء استيراد إصلاح',
    confirm: (n: number) => `سيُنشأ استيراد جديد يضم ${n} صفاً فاشلاً فقط. لن يُعاد تنفيذ الصفوف الناجحة، وتبقى نتائج هذا التنفيذ كما هي. ستحتاج إلى معاينة وموافقة جديدتين قبل أي تنفيذ.`,
    confirmLabel: 'إنشاء الإصلاح',
    failed: 'تعذر إنشاء الإصلاح.',
    bannerTitle: 'إصلاح صفوف فاشلة',
    bannerBody: 'هذا استيراد جديد يضم الصفوف الفاشلة وحدها. عدّل الحقول المرتبطة بالفشل فقط، ثم أنشئ معاينة جديدة ووافق عليها. الصفوف الناجحة لا تُعاد.',
    origin: 'فتح التنفيذ الأصلي',
    why: 'سبب الفشل',
    editable: 'الحقول القابلة للتعديل',
    noneEditable: 'لا حقول للتعديل — الفشل لم يكن بسبب بيانات؛ أعد التحقق والموافقة.',
    locked: 'غير قابل للتعديل: لم يتسبب في فشل هذا الصف',
    imagesKind: 'صور فشلت بعد حفظ المنتج',
    scopeAll: 'رفضت قاعدة نشاط الصف دون تحديد حقل بعينه؛ تُفتح حقوله (عدا المعرّف).',
  },
  en: {
    button: 'Repair and retry',
    resume: 'Continue the open repair',
    working: 'Creating the repair…',
    summary: (n: number) => `${n} row(s) need a repair — “Retry” cannot fix them.`,
    retryFirst: 'The remaining failed rows can be retried under the current approval; use “Retry”.',
    confirmTitle: 'Create a repair import',
    confirm: (n: number) => `A new import containing only the ${n} failed row(s) will be created. Successful rows are never re-run and this execution’s results stay as they are. A new preview and approval are required before anything runs.`,
    confirmLabel: 'Create repair',
    failed: 'Could not create the repair.',
    bannerTitle: 'Repairing failed rows',
    bannerBody: 'This is a new import holding only the failed rows. Edit only the fields tied to the failure, then generate and approve a new preview. Successful rows are not repeated.',
    origin: 'Open the original execution',
    why: 'Why it failed',
    editable: 'Editable fields',
    noneEditable: 'No fields to edit — the failure was not caused by data; re-validate and re-approve.',
    locked: 'Locked: it did not cause this row’s failure',
    imagesKind: 'Images that failed after the product was saved',
    scopeAll: 'A business rule rejected the row without naming a field; its own fields are open (never the identifier).',
  },
};

export function repairText(lang: Lang) {
  return TEXT[lang];
}
