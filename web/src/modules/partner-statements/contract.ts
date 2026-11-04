/**
 * عقد واجهة «مطابقة كشوف الأطراف» (IMP-PS-A4a) — أنواع وثوابت ودوال عرض نقيّة فوق REST القائم (N1/N2 + `import/*` + `import-jobs`).
 * **قراءة واستيراد فقط**: لا مطابقة ولا قرارات ولا إغلاق (A4b+). النقود تصل بالهللات `*_minor` وتُحوَّل إلى ريال عند حدّ العرض وحده؛ لا حساب مالي هنا.
 * مصدر الحدود: `PartnerStatementImportService` (2000 صف · 5MB · سماح التاريخ 0–30 · سماح المبلغ ≤ 10000 هللة · فترة ≤ 1830 يوماً).
 */
import { normalizeDecimalInput } from '@/lib/decimal-input';
import { formatRiyal } from '@/lib/money';

export const APP_KEY = 'accounting.partner_statements';
export const PERMISSION_VIEW = 'partner_statements.view';
export const PERMISSION_RECONCILE = 'partner_statements.reconcile';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_DATE_TOLERANCE_DAYS = 30;
export const MAX_AMOUNT_TOLERANCE_MINOR = 10_000;
export const DEFAULT_DATE_TOLERANCE_DAYS = 3;
export const DEFAULT_AMOUNT_TOLERANCE_MINOR = 0;
export const MAX_PERIOD_DAYS = 1830;
export const PREVIEW_ROW_LIMIT = 200;
export const ACCEPTED_IMPORT_TYPES = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const STATUSES = ['draft', 'reviewed', 'closed', 'voided', 'superseded'] as const;
export type ReconciliationStatus = (typeof STATUSES)[number];
export const ROLES = ['customer', 'supplier'] as const;
export type PartnerRole = (typeof ROLES)[number];
export const DIRECTIONS = ['positive_is_debit', 'positive_is_credit'] as const;
export type AmountDirection = (typeof DIRECTIONS)[number];

export const STATUS_TONE: Record<ReconciliationStatus, 'muted' | 'warning' | 'positive' | 'negative' | 'neutral'> = {
  draft: 'muted',
  reviewed: 'warning',
  closed: 'positive',
  voided: 'negative',
  superseded: 'neutral',
};

export interface ReconciliationRow {
  id: string;
  status: ReconciliationStatus;
  role: PartnerRole;
  partner_id: string;
  partner: { id?: string; name: string; code?: string | null } | null;
  branch_id: string | null;
  branch: { id?: string; name: string } | null;
  period_from: string;
  period_to: string;
  currency: string;
  original_filename: string | null;
  line_count: number;
  total_debit_minor: number;
  total_credit_minor: number;
  created_by: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  closed_at: string | null;
  voided_at: string | null;
  superseded_by_id: string | null;
}

export interface PageMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface ReconciliationPage {
  data: ReconciliationRow[];
  meta: PageMeta;
}

export interface FieldDefinition {
  key: string;
  label_ar: string;
  label_en: string;
  type: string;
  required: boolean;
}

export interface InspectColumn {
  index: number;
  header: string;
  samples: string[];
  suggested_field: string | null;
}

export interface InspectResult {
  columns: InspectColumn[];
  total_rows: number;
  fields: FieldDefinition[];
}

export type ColumnMapping = Record<number, string | null>;

export interface PreviewRow {
  row: number;
  action: string;
  status: 'ok' | 'warning' | 'error';
  valid: boolean;
  line_date: string | null;
  reference: string | null;
  our_reference: string | null;
  description: string | null;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number | null;
  kind: string | null;
  messages: string[];
  warnings: string[];
}

export interface PreviewPolicy {
  version: number;
  currency: string;
  date_tolerance_days: number;
  amount_tolerance_minor: number;
  amount_direction: AmountDirection | null;
  include_reversed: boolean;
  branch_id: string | null;
}

export interface PreviewResult {
  partner_id: string;
  partner_name: string;
  role: PartnerRole;
  period_from: string;
  period_to: string;
  currency: string;
  policy: PreviewPolicy;
  mapping: Record<number, string | null>;
  total_rows: number;
  line_rows: number;
  warning_rows: number;
  error_rows: number;
  valid_rows: number;
  invalid_rows: number;
  total_debit_minor: number;
  total_credit_minor: number;
  checks: {
    balance_rows: number;
    balance_pairs_checked: number;
    balance_mismatches: number[];
    balance_mismatches_truncated: boolean;
  };
  already_imported: boolean;
  existing_reconciliation_id: string | null;
  rows: PreviewRow[];
  rows_shown: number;
  rows_truncated: boolean;
  errors: { row: number; messages: string[] }[];
  binding?: { id: string; hash: string; expires_at?: string };
}

/** ناتج `apply_result` لتشغيلة `partner_statement` (محوّل A1). `replayed` = الملف نفسه استُورد سابقاً. */
export interface ApplyResult {
  reconciliation_id?: string;
  created?: number;
  skipped?: number;
  replayed?: boolean;
  lines?: number;
  total_rows?: number;
}

/** هللات → نص عشري بمنزلتين بحساب صحيح (بلا فاصلة عائمة). */
export function minorToDecimal(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const cents = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${cents}`;
}

/** عرض مبلغ بالهللات بالريال (أرقام لاتينية وكسران)؛ `null`/غير صالح ⇒ شرطة. */
export function formatMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return formatRiyal(minorToDecimal(minor));
}

/**
 * مدخل ريال من المستخدم ⇒ هللات صحيحة، أو `null` عند أي التباس (سالب · أكثر من منزلتين · خارج 0..سقف الخادم).
 * يقبل الأرقام العربية-الهندية ويحوّلها لاتينية قبل التحليل.
 */
export function riyalToMinor(input: string, maxMinor = MAX_AMOUNT_TOLERANCE_MINOR): number | null {
  const normalized = normalizeDecimalInput(input, 2);
  if (normalized === null || normalized.startsWith('-')) return null;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > 2) return null;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > maxMinor) return null;
  return minor;
}

/** أيام بين تاريخين `YYYY-MM-DD` (UTC، بلا انزلاق منطقة زمنية)؛ `null` إن كان أحدهما غير صالح. */
export function daysBetween(from: string, to: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const date = new Date(time);
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? time : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

export type PeriodIssue = 'missing' | 'invalid' | 'inverted' | 'too_long';

export function periodIssue(from: string, to: string): PeriodIssue | null {
  if (!from || !to) return 'missing';
  const days = daysBetween(from, to);
  if (days === null) return 'invalid';
  if (days < 0) return 'inverted';
  if (days > MAX_PERIOD_DAYS) return 'too_long';
  return null;
}

export function fieldLabel(field: Pick<FieldDefinition, 'label_ar' | 'label_en'>, locale: string): string {
  return locale === 'en' ? field.label_en : field.label_ar;
}

export function partnerDisplayName(row: Pick<ReconciliationRow, 'partner'>): string {
  return row.partner?.name?.trim() || '—';
}

/** خيار «المؤسسة كلها» لا يُعرض لمقيَّد بفروع (`ActorScope.branches` غير فارغة = مقيَّد). الخادم هو السلطة. */
export function mayUseOrganizationScope(branchIds: readonly string[] | null | undefined): boolean {
  return !branchIds || branchIds.length === 0;
}

/** أرقام عربية-هندية/فارسية ⇒ لاتينية (0–9). تُطبَّق على كل مدخل رقمي كي لا تُخزَّن ولا تُعرض الأرقام بغير اللاتينية. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}
