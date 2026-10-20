// AI-ACTIONS-04 — عقد المعاينة النهائية والموافقة لاستيراد المنتجات عبر مساعد أَوْج.
// الخادم هو المرجع الوحيد: المعاينة والبصمة وحالة الموافقة تُقرأ منه ولا تُحسب هنا.
// المبالغ تصل بالهللات (أعداد صحيحة) وتُحوَّل إلى ريال في طبقة العرض فقط.

import type { PreviewImages, PreviewImagesSummary } from './product-images';

export type PreviewOperation = 'create' | 'update' | 'skip' | 'blocked';
export type RowDecision = 'create' | 'update' | 'skip' | 'needs_review';
export type IssueSeverity = 'error' | 'warning';

export interface PreviewIssue {
  code: string;
  field: string | null;
  severity: IssueSeverity;
  message: string;
}

export interface PreviewChange {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  /** القيمة محجوبة عن مستخدم لا يملك `products.view_cost`. */
  redacted?: boolean;
}

export interface PreviewPrice {
  before: number | null;
  after: number | null;
  redacted?: boolean;
}

export interface PreviewRow {
  row_id: string;
  source_row: number;
  decision: RowDecision;
  display: { name: string | null; sku: string | null; barcode: string | null };
  operation: PreviewOperation;
  skip_reason: 'user_skip' | 'no_changes' | null;
  match: {
    kind: 'nebrax_id' | 'sku' | 'barcode' | 'none';
    value: string | null;
    target_product_id: string | null;
    target_version: string | null;
    target_name: string | null;
    target_sku: string | null;
  };
  changes: PreviewChange[];
  prices: Partial<Record<'sale_price' | 'purchase_price' | 'min_sale_price' | 'tax_rate', PreviewPrice>> | null;
  images: PreviewImages | null;
  issues: PreviewIssue[];
}

export interface PreviewTotals {
  rows: number;
  create: number;
  update: number;
  skip: number;
  blocked: number;
  errors: number;
  warnings: number;
  has_cost_values: boolean;
  images: number;
}

export interface ApprovalInfo {
  id: string;
  preview_id: string;
  action_version: number;
  preview_hash: string;
  approved_by: string;
  approved_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  status: 'active' | 'revoked' | 'expired';
}

export interface ProductPreview {
  id: string;
  action_id: string;
  action_version: number;
  status: 'active' | 'invalidated' | 'expired';
  invalidation_reason: string | null;
  preview_hash: string;
  approvable: boolean;
  generated_at: string | null;
  expires_at: string | null;
  totals: PreviewTotals;
  issues: PreviewIssue[];
  images: PreviewImagesSummary | null;
  rows: PreviewRow[];
  pagination: { page: number; per_page: number; total: number; last_page: number; operation: PreviewOperation | null };
  approval: ApprovalInfo | null;
  permissions: { can_view_cost: boolean; cost_hidden: boolean; can_approve: boolean };
}

export const OPERATION_LABEL: Record<PreviewOperation, string> = {
  create: 'إنشاء',
  update: 'تحديث',
  skip: 'تخطٍّ',
  blocked: 'موقوف',
};

export const OPERATION_TONE: Record<PreviewOperation, 'positive' | 'neutral' | 'muted' | 'negative'> = {
  create: 'positive',
  update: 'neutral',
  skip: 'muted',
  blocked: 'negative',
};

export const DECISION_LABEL: Record<RowDecision, string> = {
  create: 'إنشاء',
  update: 'تحديث',
  skip: 'تخطٍّ',
  needs_review: 'يحتاج قراراً',
};

export const FIELD_LABEL: Record<string, string> = {
  nebrax_id: 'معرّف نبراكس',
  sku: 'رمز الصنف',
  name: 'الاسم',
  name_en: 'الاسم بالإنجليزية',
  type: 'النوع',
  unit: 'الوحدة',
  unit_template: 'قالب الوحدات',
  category: 'التصنيف',
  brand: 'العلامة التجارية',
  barcode: 'الباركود',
  sale_price: 'سعر البيع',
  purchase_price: 'سعر الشراء',
  min_sale_price: 'أقل سعر بيع',
  tax_rate: 'نسبة الضريبة',
  track_inventory: 'تتبع المخزون',
  reorder_level: 'حد إعادة الطلب',
  tags: 'الوسوم',
  description: 'الوصف',
  internal_notes: 'ملاحظات داخلية',
  is_active: 'نشط',
};

export const MONEY_FIELDS = ['sale_price', 'purchase_price', 'min_sale_price'] as const;

export const PRICE_LABEL: Record<string, string> = {
  sale_price: 'سعر البيع',
  purchase_price: 'سعر الشراء',
  min_sale_price: 'أقل سعر بيع',
  tax_rate: 'الضريبة',
};

/** الفرق الذي يغيّر الأثر: كل ما سيُنشأ أو يُحدَّث. */
export function appliesChanges(totals: PreviewTotals): number {
  return totals.create + totals.update;
}

/** هللات صحيحة → نص ريال بمنزلتين، بحساب صحيح بلا float. يعيد `null` لقيمة غير صالحة. */
export function minorToRiyal(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined || !Number.isInteger(minor)) return null;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/** بصمة مختصرة للعرض فقط؛ الموافقة تُرسَل بالبصمة الكاملة دائماً. */
export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

/** يمكن إرسال الموافقة؟ — حارسٌ للواجهة فقط؛ الخادم يعيد كل الفحوص. */
export function canSubmitApproval(preview: ProductPreview | null, acknowledged: boolean, busy: boolean, dirty: boolean): boolean {
  return (
    preview !== null &&
    acknowledged &&
    !busy &&
    !dirty &&
    preview.status === 'active' &&
    preview.approvable &&
    preview.approval === null &&
    preview.permissions.can_approve
  );
}

/** سبب تعطيل زر الموافقة بنصٍّ للمستخدم، أو `null` إن كان متاحاً (عدا التأكيد). */
export function approvalBlockReason(preview: ProductPreview, dirty: boolean): string | null {
  if (dirty) return 'لديك تعديلات غير محفوظة؛ احفظها وأنشئ معاينة جديدة.';
  if (preview.approval?.status === 'active') return null;
  if (preview.status === 'invalidated') return 'أُبطلت هذه المعاينة؛ أنشئ معاينة جديدة.';
  if (preview.status === 'expired') return 'انتهت صلاحية المعاينة؛ أنشئ معاينة جديدة.';
  if (!preview.approvable) return 'توجد أخطاء تمنع التنفيذ؛ صحّحها ثم أنشئ معاينة جديدة.';
  if (!preview.permissions.can_approve) {
    return preview.permissions.cost_hidden
      ? 'تحتوي المعاينة أسعار شراء؛ الموافقة تتطلب صلاحية عرض التكلفة.'
      : 'ليست لديك صلاحية الموافقة على إجراءات المساعد.';
  }
  return null;
}

/** أخطاء الخادم التي تعني أن المعاينة المعروضة لم تعد صالحة وتلزم معاينة جديدة. */
export const STALE_PREVIEW_CODES = ['preview_stale', 'preview_expired', 'preview_invalidated', 'version_conflict', 'preview_hash_mismatch', 'state_conflict'] as const;

export function isStalePreviewCode(code: string | null | undefined): boolean {
  return code !== null && code !== undefined && (STALE_PREVIEW_CODES as readonly string[]).includes(code);
}

/** رمز الخطأ من جسم استجابة الـ API (`{error:{code,message}}`). */
export function errorCode(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { code?: unknown } }).error;
    if (error && typeof error === 'object' && typeof error.code === 'string') return error.code;
  }
  return null;
}

/** ملخص الصفوف الموقوفة حسب الرمز، لعرض «لماذا لا أستطيع الموافقة». */
export function issueCounts(rows: PreviewRow[]): { code: string; severity: IssueSeverity; count: number }[] {
  const map = new Map<string, { code: string; severity: IssueSeverity; count: number }>();
  for (const row of rows) {
    for (const issue of row.issues) {
      const key = `${issue.severity}:${issue.code}`;
      const entry = map.get(key) ?? { code: issue.code, severity: issue.severity, count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1));
}

export const ISSUE_TITLE: Record<string, string> = {
  required_missing: 'حقل مطلوب ناقص',
  decision_required: 'يحتاج قراراً صريحاً',
  existing_product_matches: 'يطابق منتجاً موجوداً',
  update_target_missing: 'لا يوجد منتج للتحديث',
  target_not_found: 'معرّف نبراكس غير موجود',
  invalid_nebrax_id: 'معرّف نبراكس غير صالح',
  identifier_conflict: 'تعارض معرّفات',
  duplicate_in_file: 'مكرر داخل الملف',
  duplicate_target: 'منتج مستهدف مرتين',
  update_locked: 'حقل لا يتغيّر بالاستيراد',
  barcode_taken: 'باركود مستخدم',
  invalid_money: 'مبلغ غير صالح',
  money_out_of_range: 'مبلغ خارج النطاق',
  invalid_integer: 'عدد غير صالح',
  integer_out_of_range: 'قيمة خارج النطاق',
  invalid_boolean: 'قيمة منطقية غير صالحة',
  invalid_enum: 'نوع غير صالح',
  invalid_format: 'صيغة غير صالحة',
  too_long: 'نص أطول من المسموح',
  min_sale_price_above_sale_price: 'أقل سعر أعلى من سعر البيع',
  service_tracks_inventory: 'خدمة بتتبع مخزون',
  invalid_image_url: 'رابط صورة غير صالح',
  too_many_images: 'صور أكثر من الحد',
  empty_proposal: 'لا صفوف',
  nothing_to_apply: 'لا شيء سيُطبَّق',
  purchase_price_missing: 'سعر الشراء مطلوب للإنشاء',
  tax_rate_missing: 'نسبة الضريبة مطلوبة للإنشاء',
  unit_missing: 'الوحدة مطلوبة للإنشاء',
  trusted_identifier_missing: 'يلزم SKU أو باركود',
  reference_unresolved: 'تصنيف/علامة غير موجودة',
  reference_ambiguous: 'اسم تصنيف/علامة مكرَّر',
  media_update_not_approved: 'صور المنتج الموجود غير معتمدة',
  media_deferred: 'استيراد الصور مؤجَّل',
  remote_fetch_disabled: 'جلب الصور من الروابط غير مفعّل',
  remote_fetch_limit: 'روابط صور أكثر من الحد',
  image_url_blocked: 'رابط صورة مرفوض أمنياً',
  image_fetch_failed: 'تعذّر تنزيل صورة',
  image_invalid: 'صورة غير صالحة',
  image_not_staged: 'صورة لم تُجهَّز',
  archive_image_ambiguous: 'صورة تطابق أكثر من صف',
  multiple_primary_images: 'أكثر من صورة رئيسية',
  unit_template_deferred: 'قالب الوحدات مؤجَّل',
};

/** رسالة الخطأ العربية من جسم `{error:{message}}` (الـ API لا يضعها في الجذر كبقية النقاط). */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
    const root = (body as { message?: unknown }).message;
    if (typeof root === 'string' && root !== '') return root;
  }
  return fallback;
}
