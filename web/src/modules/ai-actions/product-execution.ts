// AI-ACTIONS-05 — عقد تنفيذ الاستيراد المعتمد وعرض نتيجته.
// الخادم هو المرجع الوحيد للحالة والنتائج؛ الواجهة تعرضها وتقود الدفعات فقط.

export type ExecutionStatus = 'running' | 'completed' | 'partially_failed' | 'failed';
export type RowStatus = 'pending' | 'success' | 'failed' | 'skipped';
export type Lang = 'ar' | 'en';

export interface ExecutionRow {
  row_id: string;
  source_row: number;
  operation: 'create' | 'update' | 'skip';
  status: RowStatus;
  product_id: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  attempts: number;
  changed_fields: string[];
  deferred: string[];
  display: { name: string | null; sku: string | null; barcode: string | null } | null;
}

export interface Execution {
  id: string;
  action_id: string;
  status: ExecutionStatus;
  started_at: string | null;
  finished_at: string | null;
  retry_count: number;
  progress: { total: number; pending: number; success: number; failed: number; skipped: number };
  deferred: { images: string; unit_template: string };
  rows: ExecutionRow[];
  pagination: { page: number; per_page: number; total: number; last_page: number; status: RowStatus | null };
  permissions: { can_continue: boolean; can_retry: boolean; retryable_rows: number };
}

/** لغة الواجهة الحالية (`<html lang>`)؛ العربية الافتراضية. */
export function currentLang(): Lang {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return lang.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const TEXT = {
  ar: {
    title: 'تنفيذ الاستيراد',
    intro: 'الموافقة لا تنفّذ شيئاً تلقائياً. اضغط «تنفيذ الاستيراد» لإنشاء المنتجات وتحديثها بحسب المعاينة المعتمدة فقط.',
    deferredTitle: 'مؤجَّل في هذه المرحلة',
    deferredBody: 'صور المنتجات وقوالب الوحدات لا تُستورد ولا تُطبَّق، ولن تُعدّ ناجحة. لا يتغيّر المخزون ولا القيود المحاسبية.',
    run: 'تنفيذ الاستيراد',
    running: 'جارٍ التنفيذ…',
    confirmTitle: 'تأكيد تنفيذ الاستيراد',
    confirm: (create: number, update: number) => `سيُنشأ ${create} منتجاً ويُحدَّث ${update} منتجاً بحسب المعاينة المعتمدة. لا يُعاد تنفيذ الصفوف الناجحة، ولا يمكن التراجع تلقائياً.`,
    confirmLabel: 'تنفيذ',
    progress: (done: number, total: number) => `${done} من ${total} صف`,
    completed: 'اكتمل التنفيذ — كل الصفوف نُفِّذت أو تُخطّيت.',
    partially: 'نُفِّذ جزء من الصفوف وفشل بعضها. الصفوف الناجحة نهائية ولن تُكرَّر.',
    failed: 'فشلت كل الصفوف المطلوبة.',
    retry: 'إعادة محاولة الصفوف الفاشلة',
    retryHint: (n: number) => `${n} صفاً قابلاً لإعادة المحاولة. الصفوف الناجحة لا تُعاد.`,
    notRetryable: 'الصفوف الفاشلة المتبقية تحتاج إصلاحاً في البيانات (استيراد جديد).',
    counts: { success: 'ناجح', failed: 'فاشل', skipped: 'متخطّى', pending: 'قيد الانتظار' },
    all: 'الكل',
    columns: ['الصف', 'المنتج', 'العملية', 'النتيجة', 'التفاصيل'],
    operations: { create: 'إنشاء', update: 'تحديث', skip: 'تخطٍّ' },
    openProduct: 'فتح المنتج',
    changed: 'الحقول المطبّقة',
    deferredRow: 'مؤجَّل',
    deferredFields: { images: 'الصور', unit_template: 'قالب الوحدات' } as Record<string, string>,
    attempts: 'محاولات',
    retryable: 'قابل لإعادة المحاولة',
    errorTitle: 'تعذر التنفيذ',
    busyElsewhere: 'هذا التنفيذ قيد المعالجة في طلب آخر؛ نتابع الحالة تلقائياً.',
    fields: {} as Record<string, string>,
  },
  en: {
    title: 'Run import',
    intro: 'Approval does not run anything by itself. Press “Run import” to create and update products exactly as in the approved preview.',
    deferredTitle: 'Deferred in this phase',
    deferredBody: 'Product images and unit templates are not imported or applied and are never counted as success. Stock and accounting entries are not touched.',
    run: 'Run import',
    running: 'Running…',
    confirmTitle: 'Confirm import execution',
    confirm: (create: number, update: number) => `${create} product(s) will be created and ${update} updated exactly as approved. Successful rows are never repeated and nothing is rolled back automatically.`,
    confirmLabel: 'Run',
    progress: (done: number, total: number) => `${done} of ${total} rows`,
    completed: 'Finished — every row was applied or skipped.',
    partially: 'Some rows were applied and some failed. Successful rows are final and will not be repeated.',
    failed: 'Every row that had to be applied failed.',
    retry: 'Retry failed rows',
    retryHint: (n: number) => `${n} row(s) can be retried. Successful rows are never re-run.`,
    notRetryable: 'The remaining failed rows need their data fixed (start a new import).',
    counts: { success: 'Succeeded', failed: 'Failed', skipped: 'Skipped', pending: 'Pending' },
    all: 'All',
    columns: ['Row', 'Product', 'Operation', 'Result', 'Details'],
    operations: { create: 'Create', update: 'Update', skip: 'Skip' },
    openProduct: 'Open product',
    changed: 'Applied fields',
    deferredRow: 'Deferred',
    deferredFields: { images: 'Images', unit_template: 'Unit template' } as Record<string, string>,
    attempts: 'attempts',
    retryable: 'Retryable',
    errorTitle: 'Could not run',
    busyElsewhere: 'This run is being processed by another request; following its status automatically.',
    fields: {} as Record<string, string>,
  },
};

export function execText(lang: Lang) {
  return TEXT[lang];
}

export function statusLabel(lang: Lang, status: RowStatus): string {
  return TEXT[lang].counts[status];
}

export const ROW_TONE: Record<RowStatus, 'positive' | 'negative' | 'muted' | 'warning'> = {
  success: 'positive',
  failed: 'negative',
  skipped: 'muted',
  pending: 'warning',
};

/** نسبة الإنجاز: ما لم يعد قيد الانتظار من كل الصفوف. */
export function progressPercent(progress: Execution['progress']): number {
  if (progress.total <= 0) return 0;
  return Math.round(((progress.total - progress.pending) / progress.total) * 100);
}

export function isFinished(status: ExecutionStatus): boolean {
  return status !== 'running';
}

/** حالات الإجراء التي لا تقبل تعديلاً بعد بدء التنفيذ. */
export const EXECUTION_LOCKED_STATUSES = ['executing', 'executed', 'partially_failed', 'failed'] as const;

export function isExecutionLocked(actionStatus: string | null | undefined): boolean {
  return actionStatus !== null && actionStatus !== undefined && (EXECUTION_LOCKED_STATUSES as readonly string[]).includes(actionStatus);
}
