/**
 * ترجمة أخطاء وحدة «كشوف الأطراف» إلى مفاتيح رسائل (ar/en) — **المفتاح هو `reason` (أو `code` لاستثناءات المعاينة) حين يوجد، ثم نصّ الخادم المعروف، ثم حالة HTTP**.
 * لا نص خادم خام يصل إلى المستخدم أبداً: المجهول يسقط إلى رسالة عامة آمنة بحسب الحالة. (رسائل صفوف المعاينة وحدها تُعرض كما ترد لأنها وصفٌ لبيانات الملف نفسه.)
 *
 * **عدم التسريب:** «الطرف غير متاح» و«الفرع خارج نطاقك» يُدمجان في رسالة واحدة (`unavailable`) كي لا تُكبّر الواجهة فارقاً قائماً في الخادم يكشف وجود فرع/طرف.
 */
import { ApiError } from '@/lib/api';

export type ErrorKind = 'auth' | 'forbidden' | 'disabled' | 'suspended' | 'conflict' | 'validation' | 'throttled' | 'not_found' | 'network' | 'unknown';

export interface ErrorDescriptor {
  /** مفتاح تحت `partnerStatements.errors` */
  key: string;
  kind: ErrorKind;
  /** الرمز المستعمل في الحسم (للاختبار والتتبّع)، لا للعرض. */
  code: string | null;
  /** تفاصيل آمنة من الخادم (معرّفات/أرقام فقط، مثل `difference_minor` و`tolerance_minor`) — لا نص. */
  details?: Record<string, unknown>;
}

/** عائلات أسباب دورة المراجعة (§2.3 من الخطة) — تُترجَم بعائلة لا برمز رمز، وتُستعمل بدءاً من A4b. */
const REASON_FAMILIES: Record<string, string> = {
  run_stale: 'family_stale',
  // سطور الكشف تغيّرت خارج التطبيق: **حظر كامل** — إعادة تشغيل المطابقة لا تُصلحه (يرفضها الخادم بالرمز نفسه).
  statement_changed: 'statement_changed',
  run_is_not_the_reviewed_run: 'family_stale',
  void_policy_changed: 'family_stale',
  reconciliation_not_draft: 'family_state',
  reconciliation_not_reviewed: 'family_state',
  reconciliation_not_editable: 'family_state',
  reconciliation_not_closed: 'family_state',
  reconciliation_already_closed: 'family_state',
  reconciliation_already_voided: 'family_state',
  reconciliation_already_superseded: 'family_state',
  overlap_ack_required: 'family_overlap',
  overlap_ack_stale: 'family_overlap',
  final_already_exists: 'family_conflict',
  unit_conflict: 'family_conflict',
  closer_must_differ_from_reviewer: 'family_separation',
  void_separation_required: 'family_separation',
  platform_emergency_stop: 'family_unavailable',
  duplicate_document: 'family_conflict',
  // ——— قرارات المراجعة الفردية (PS-A4b) ———
  reason_required: 'reason_required',
  reason_too_long: 'reason_too_long',
  difference_exceeds_tolerance: 'difference_exceeds_tolerance',
  unit_already_decided: 'unit_already_decided',
  dismiss_requires_missing_in_books: 'dismiss_requires_missing_in_books',
  nothing_to_confirm: 'nothing_to_confirm',
  line_not_in_run: 'line_unavailable',
  line_not_found: 'line_unavailable',
  unit_keys_invalid: 'units_invalid',
  unit_keys_not_allowed: 'units_invalid',
  unit_not_in_ledger: 'units_invalid',
  unit_not_reviewable: 'units_invalid',
  pair_member_required: 'pair_invalid',
  pair_member_not_allowed: 'pair_invalid',
  pair_not_proven: 'pair_invalid',
  pair_not_simple: 'pair_invalid',
  pair_incomplete: 'pair_invalid',
  unit_not_a_reversed_pair: 'pair_invalid',
  action_invalid: 'validation',
};

/** رموز المعاينة/التنفيذ المربوط (`ImportPreviewException`، المفتاح `code`). */
const PREVIEW_CODES: Record<string, string> = {
  preview_invalid: 'preview_stale',
  preview_consumed: 'preview_stale',
  preview_expired: 'preview_stale',
  preview_mismatch: 'preview_stale',
  preview_required: 'preview_stale',
  options_frozen: 'preview_stale',
};

/** نصوص الخادم المعروفة (استثناءات `RuntimeException` في خدمة الاستيراد) ⇒ مفتاح. المطابقة بالتضمين لا بالمساواة كي تصمد أمام تغيّر الترقيم/التشكيل الطفيف. */
const KNOWN_MESSAGES: { match: string; key: string }[] = [
  { match: 'الطرف غير متاح لك في هذا الدور', key: 'unavailable' },
  { match: 'هذا الفرع خارج نطاق صلاحياتك', key: 'unavailable' },
  { match: 'كشوف الأطراف بالريال السعودي', key: 'sar_only' },
  { match: 'بداية الفترة بعد نهايتها', key: 'period_inverted' },
  { match: 'فترة الكشف تتجاوز', key: 'period_too_long' },
  { match: 'لا يحتوي الملف صفوف', key: 'no_rows' },
  { match: 'الملف فارغ', key: 'file_empty' },
  { match: 'صيغة الملف غير مدعومة', key: 'file_type' },
  { match: 'أكثر من عمود مربوط بالحقل نفسه', key: 'mapping_duplicate' },
  { match: 'الاستيراد يحتاج عمود', key: 'mapping_missing_date' },
  { match: 'لا الاثنين معاً', key: 'mapping_amount_conflict' },
  { match: 'ملتبس', key: 'mapping_amount_missing' },
  { match: 'الملف يحتاج عمودَي', key: 'mapping_amount_missing' },
  { match: 'يلزمه تحديد اتجاهه', key: 'direction_required' },
  { match: 'اتجاه المبلغ يخص ملف العمود الواحد', key: 'direction_unexpected' },
  { match: 'بالهللات لا بالنسبة', key: 'tolerance_percent' },
  { match: 'فرق التاريخ المسموح', key: 'date_tolerance_invalid' },
  { match: 'فرق المبلغ المسموح', key: 'amount_tolerance_invalid' },
  { match: 'قبل معالجة الأخطاء الظاهرة في المعاينة', key: 'rows_have_errors' },
  { match: 'اختر الطرف', key: 'unavailable' },
  { match: 'معرّف الطرف غير صالح', key: 'unavailable' },
  { match: 'معرّف الفرع غير صالح', key: 'unavailable' },
];

function bodyOf(error: ApiError): { message?: unknown; reason?: unknown; code?: unknown; errors?: unknown; details?: unknown } {
  return error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : {};
}

function fromMessage(message: string): string | null {
  const found = KNOWN_MESSAGES.find((entry) => message.includes(entry.match));
  return found ? found.key : null;
}

/** تصنيف 403 بحسب حارس القدرة (`EnsureApplicationActive`): موقوفة (قراءة فقط) ≠ معطّلة ≠ منع صلاحية. */
export function classifyForbidden(message: string): 'suspended' | 'disabled' | 'forbidden' {
  if (message.includes('معلّقة')) return 'suspended';
  if (message.includes('غير مفعّلة') || message.includes('غير متاحة لهذه المؤسسة')) return 'disabled';
  return 'forbidden';
}

export function describeError(error: unknown): ErrorDescriptor {
  if (!(error instanceof ApiError)) {
    return { key: 'network', kind: 'network', code: null };
  }

  const body = bodyOf(error);
  const reason = typeof body.reason === 'string' ? body.reason : typeof body.code === 'string' ? body.code : null;
  const message = typeof body.message === 'string' ? body.message : error.message;

  if (reason && PREVIEW_CODES[reason]) return { key: PREVIEW_CODES[reason], kind: 'conflict', code: reason };
  if (reason && REASON_FAMILIES[reason]) {
    const details = body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? (body.details as Record<string, unknown>) : undefined;
    return { key: REASON_FAMILIES[reason], kind: error.status === 409 ? 'conflict' : 'validation', code: reason, ...(details ? { details } : {}) };
  }

  switch (error.status) {
    case 401:
      return { key: 'auth', kind: 'auth', code: null };
    case 403: {
      const kind = classifyForbidden(message);
      return { key: kind === 'forbidden' ? 'forbidden' : kind, kind, code: null };
    }
    case 404:
      return { key: 'not_found', kind: 'not_found', code: null };
    case 409:
      return { key: 'conflict', kind: 'conflict', code: reason };
    case 413:
      return { key: 'file_too_large', kind: 'validation', code: null };
    case 429:
      return { key: 'throttled', kind: 'throttled', code: null };
    case 422: {
      const known = fromMessage(message);
      if (known) return { key: known, kind: 'validation', code: null };
      if (body.errors && typeof body.errors === 'object') {
        const fields = Object.keys(body.errors as object);
        if (fields.includes('file')) return { key: 'file_invalid', kind: 'validation', code: null };
        return { key: 'validation', kind: 'validation', code: null };
      }
      return { key: 'validation', kind: 'validation', code: null };
    }
    default:
      return { key: 'unknown', kind: 'unknown', code: reason };
  }
}

/** خطأ وصل نصاً فقط (محرّك التشغيلات يحتفظ بـ`message` لا بالاستثناء): يُحسم بالنص المعروف وإلا فعامّ. */
export function describeMessage(message: string | null | undefined): ErrorDescriptor {
  const text = message ?? '';
  const forbidden = text.includes('هذه القدرة') ? classifyForbidden(text) : null;
  if (forbidden && forbidden !== 'forbidden') return { key: forbidden, kind: forbidden, code: null };
  const known = fromMessage(text);
  return known ? { key: known, kind: 'validation', code: null } : { key: 'unknown', kind: 'unknown', code: null };
}

/** كل المفاتيح التي قد تُرجعها `describeError` — يحرس الاختبار وجود ترجمة ar/en لكل منها. */
export const ALL_ERROR_KEYS: readonly string[] = Array.from(
  new Set([
    'network', 'auth', 'forbidden', 'disabled', 'suspended', 'not_found', 'conflict', 'file_too_large', 'throttled', 'validation', 'file_invalid', 'file_too_many_rows', 'unknown',
    ...Object.values(PREVIEW_CODES),
    ...Object.values(REASON_FAMILIES),
    ...KNOWN_MESSAGES.map((entry) => entry.key),
  ]),
);
