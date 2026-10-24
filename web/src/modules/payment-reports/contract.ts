import type { BadgeTone } from '@/modules/payments/gateways/contract';

/**
 * عقد «تقارير المقاصة» (PAY-H3-03، الحد الأساسي) — أنواع ودوال نقية بلا شبكة. مرآة `PaymentClearingReportController` (قراءة فقط، `reports.view`).
 * المبالغ بالهللات. الخادم حاسم في كل رقم؛ الواجهة تعرض ولا تحسب (إلا فرق الصف الواحد للعرض).
 */

export const VIEW_PERMISSION = 'reports.view';

export const REPORT_TABS = ['reconciliation', 'differences', 'aging'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

// ───────────────────────── المطابقة ─────────────────────────

export const RECONCILIATION_STATUSES = ['reconciled', 'difference', 'unresolved'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const CHECK_KEYS = ['captures', 'refunds', 'settlements', 'other'] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export interface ReconciliationAccount { account_id: string; code: string; name: string; is_active: boolean; sources: string[]; balance: number }
export interface ReconciliationCheck { key: CheckKey; document: number; ledger: number; difference: number }
export interface ReconciliationGateway { payment_gateway_id: string; gateway_name: string | null; unsettled_captures: number; unsettled_refunds: number; expected_balance: number }
export interface OtherSource { source_type: string | null; debit: number; credit: number }

export interface ReconciliationReport {
  currency: string;
  status: ReconciliationStatus;
  mapping_state: 'mapped' | 'unmapped';
  ledger_balance: number;
  expected_balance: number;
  difference: number;
  accounts: ReconciliationAccount[];
  documents: {
    captures: number; settled_gross: number; refunds: number; deducted_refunds: number;
    capture_count: number; refund_count: number; unsettled_captures: number; unsettled_refunds: number;
  };
  checks: ReconciliationCheck[];
  other_sources: OtherSource[];
  per_gateway: ReconciliationGateway[];
  not_checked: string[];
}

export function statusTone(status: ReconciliationStatus): BadgeTone {
  return status === 'reconciled' ? 'positive' : status === 'difference' ? 'negative' : 'warning';
}

/** الفرق الصفري سليم؛ أي فرق آخر يُبرَز (بلا تمييز اتجاه — الإشارة تُعرض بنصها). */
export const differenceTone = (difference: number): BadgeTone => (difference === 0 ? 'positive' : 'negative');

/** مفاتيح «لا يشمله التقرير» المعروفة؛ غيرها يُعرض كما وصل. */
export const NOT_CHECKED_KEYS = ['per_branch_ledger', 'as_of_date', 'provider_statement', 'adjustment_reserve_accounts'] as const;
export const knownNotChecked = (key: string): key is (typeof NOT_CHECKED_KEYS)[number] => (NOT_CHECKED_KEYS as readonly string[]).includes(key);

export const knownCheckKey = (key: string): key is CheckKey => (CHECK_KEYS as readonly string[]).includes(key);

/** مصدر حساب المقاصة: `current` · `system_default` · `history`. */
export const SOURCE_LABEL_KEYS = ['current', 'system_default', 'history'] as const;
export const knownAccountSource = (s: string): s is (typeof SOURCE_LABEL_KEYS)[number] => (SOURCE_LABEL_KEYS as readonly string[]).includes(s);

/** منع الفرع: المطابقة مؤسسية فتُحجب عن المقيَّد بفروع (الخادم 403 برمز ثابت). */
export const BRANCH_SCOPE_FORBIDDEN = 'branch_scope_forbidden';

// ───────────────────────── فروقات التسويات ─────────────────────────

export interface DifferenceRow {
  id: string;
  payment_gateway_id: string;
  gateway_name: string | null;
  provider_settlement_ref: string;
  settlement_date: string | null;
  age_days: number | null;
  currency: string;
  gross_amount: number;
  net_bank_amount: number;
  unreconciled_minor: number;
}

export interface DifferencesReport {
  currency: string;
  rows: DifferenceRow[];
  has_more: boolean;
  totals: { count: number; net_minor: number; positive_minor: number; negative_minor: number; oldest_settlement_date: string | null };
}

/** إشارة الفرق الموقَّع للتسوية: موجب/سالب كلاهما تحذير (يحتاج مراجعة)، والصفر محايد. */
export const signedTone = (minor: number): BadgeTone => (minor === 0 ? 'muted' : 'warning');

export function buildDifferencesQuery(gatewayId: string): string {
  const q = new URLSearchParams();
  if (gatewayId) q.set('payment_gateway_id', gatewayId);
  const text = q.toString();
  return text === '' ? '' : `?${text}`;
}

// ───────────────────────── الأعمار ─────────────────────────

export interface BucketedAmount { count: number; total: number; buckets: number[] }
export interface AgingRow {
  branch_id: string | null;
  branch_name: string | null;
  captures: BucketedAmount;
  refunds: BucketedAmount;
  net: { total: number; buckets: number[] };
}
export interface AgingReport {
  currency: string;
  as_of: string;
  bucket_days: number[];
  rows: AgingRow[];
  totals: { captures: { total: number; buckets: number[] }; refunds: { total: number; buckets: number[] }; net: { total: number; buckets: number[] } };
  scope: 'company' | 'branches';
}

export interface BucketRange { index: number; from: number; to: number | null }

/** شرائح الأعمار من `bucket_days` (حدود علوية): [0..d1]، [d1+1..d2]، [d2+1..d3]، [d3+1..∞). */
export function bucketRanges(bucketDays: number[]): BucketRange[] {
  const out: BucketRange[] = [];
  let from = 0;
  bucketDays.forEach((to, index) => {
    out.push({ index, from, to });
    from = to + 1;
  });
  out.push({ index: bucketDays.length, from, to: null });
  return out;
}

/** أقدم شريحة فيها رصيد تحذير؛ الباقي محايد. */
export function bucketTone(index: number, lastIndex: number, value: number): BadgeTone {
  return value !== 0 && index === lastIndex ? 'warning' : 'neutral';
}

export function buildAgingQuery(branchIds: string[]): string {
  const q = new URLSearchParams();
  for (const id of branchIds) q.append('branch_id[]', id);
  const text = q.toString();
  return text === '' ? '' : `?${text}`;
}

export interface BranchOption { id: string; code: string; name: string; is_main: boolean; is_active: boolean }
