import type { BadgeTone } from '@/modules/payments/gateways/contract';

/**
 * عقد واجهة «استردادات البوابة» (PAY-H3-01e) — أنواع ودوال نقية بلا شبكة. مرآة `PaymentRefundController` (ADR-0007).
 * الخادم هو الحاسم في كل قرار؛ إخفاء الإجراء هنا راحة لا حدّ أمني. المبالغ بالهللات. لا أسرار تصل إلى هذه الأنواع.
 */

export const VIEW_PERMISSION = 'payment_refunds.view';
export const REQUEST_PERMISSION = 'payment_refunds.request';
export const APPROVE_PERMISSION = 'payment_refunds.approve';
export const RESOLVE_UNKNOWN_PERMISSION = 'payment_refunds.resolve_unknown';
export const REPOST_PERMISSION = 'payments.resolve_blocked';

export const STATUSES = ['requested', 'approved', 'submitting', 'confirmed', 'failed', 'unknown', 'rejected', 'cancelled'] as const;
export type RefundStatus = (typeof STATUSES)[number];

export const TABS = ['all', 'pending', 'attention'] as const;
export type RefundTab = (typeof TABS)[number];

export interface RefundRow {
  id: string;
  number: string;
  status: RefundStatus;
  amount_minor: number;
  currency: string;
  partner_id: string;
  partner_name: string | null;
  payment_attempt_id: string;
  requested_by: { id: string; name: string | null };
  requested_at: string | null;
  approved_by: { id: string; name: string | null } | null;
  approved_at: string | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  provider_refunded_at: string | null;
  provider_refund_ref: string | null;
  failure_code: string | null;
  retry_count: number;
  excess_minor: number;
  posting_status: 'pending' | 'posted' | 'blocked_period' | null;
  accounting_date: string | null;
  posted_at: string | null;
  journal_entry_id: string | null;
  blocked_reason: { kind?: string; [key: string]: unknown } | null;
}

export interface RefundAllocation { source_type: 'credit_note' | 'sales_return'; source_id: string; source_number: string | null; amount_minor: number }
export interface RefundInvocation { seq: number; baseline_refunded_minor: number; amount_minor: number; at: string | null }
export interface RefundTimelineEvent { action: string; from: string | null; to: string | null; reason: string | null; actor: string | null; at: string | null }

export interface RefundDetail extends RefundRow {
  allocations: RefundAllocation[];
  invocations: RefundInvocation[];
  timeline: RefundTimelineEvent[];
}

export interface EligibleSource { source_type: 'credit_note' | 'sales_return'; id: string; number: string; date: string; total: number; refunded: number; refundable: number }

export interface RefundContext {
  payment_attempt_id: string;
  currency: string;
  captured_minor: number;
  refunded_minor: number;
  refundable_minor: number;
  eligible: boolean;
  blocker: { code: string; message: string } | null;
  unrecognized_refund_at: string | null;
  unrecognized_refund_minor: number | null;
  sources: EligibleSource[];
}

export interface ListMeta { total: number; page: number; per_page: number; last_page: number }

export function buildListQuery(f: { tab: RefundTab; page: number; perPage: number }): string {
  const q = new URLSearchParams();
  q.set('page', String(f.page));
  q.set('per_page', String(f.perPage));
  return q.toString();
}

/** تبويبات تُرشَّح في الواجهة (الخادم يعيد الصفحة كاملة بالترتيب الزمني): بانتظار الاعتماد/الإرسال، وما يحتاج تدخلاً بشرياً. */
export function inTab(row: Pick<RefundRow, 'status' | 'posting_status'>, tab: RefundTab): boolean {
  if (tab === 'pending') return row.status === 'requested' || row.status === 'approved';
  if (tab === 'attention') return row.status === 'unknown' || row.status === 'failed' || row.posting_status === 'blocked_period';
  return true;
}

export function statusTone(status: RefundStatus, posting: RefundRow['posting_status']): BadgeTone {
  if (status === 'confirmed') return posting === 'blocked_period' ? 'warning' : posting === 'posted' ? 'positive' : 'neutral';
  if (status === 'failed' || status === 'rejected') return 'negative';
  if (status === 'unknown') return 'warning';
  if (status === 'cancelled') return 'muted';
  return 'neutral';
}

/** الاعتماد/الرفض لمن يملك الصلاحية وهو **ليس** الطالب (الخادم والقاعدة يفرضان ذلك أيضاً). */
export const canDecide = (row: Pick<RefundRow, 'status' | 'requested_by'>, allowed: boolean, userId: string | null): boolean =>
  allowed && row.status === 'requested' && userId !== null && row.requested_by.id !== userId;

/** الإرسال بعد الاعتماد لصاحب صلاحية الاعتماد (أي معتمِد). */
export const canSubmit = (row: Pick<RefundRow, 'status'>, allowed: boolean): boolean => allowed && row.status === 'approved';

/** الإلغاء قبل الإرسال للطالب نفسه أو لصاحب صلاحية الاعتماد. */
export const canCancel = (row: Pick<RefundRow, 'status' | 'requested_by'>, canApprove: boolean, userId: string | null): boolean =>
  (row.status === 'requested' || row.status === 'approved') && (canApprove || (userId !== null && row.requested_by.id === userId));

export const canResolve = (row: Pick<RefundRow, 'status'>, allowed: boolean): boolean => allowed && row.status === 'unknown';
export const canRepost = (row: Pick<RefundRow, 'status' | 'posting_status'>, allowed: boolean): boolean => allowed && row.status === 'confirmed' && row.posting_status === 'blocked_period';

export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const reasonValid = (reason: string): boolean => reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;

/** رموز رفض الخادم المعروفة (تُترجم في الواجهة)؛ غيرها يسقط إلى رسالة عامة. */
export const KNOWN_ERRORS = [
  'forbidden', 'rollout_disabled', 'platform_stop', 'invalid_idempotency_key', 'idempotency_conflict', 'invalid_amount', 'invalid_allocations', 'not_captured',
  'capture_not_posted', 'not_refundable', 'dispute_active', 'unrecognized_refund_open', 'gateway_unavailable', 'refunds_unsupported', 'currency_mismatch',
  'partner_mismatch', 'source_ineligible', 'source_branch_mismatch', 'capture_branch_mismatch', 'branch_context_mismatch', 'exceeds_source_balance',
  'exceeds_payment_capacity', 'invalid_state', 'self_approval', 'busy', 'provider_unavailable', 'reason_required', 'evidence_missing', 'no_unrecognized_refund',
  'not_blocked', 'not_postable', 'baseline_regressed',
] as const;
export type KnownError = (typeof KNOWN_ERRORS)[number];
export const knownError = (code: string | null | undefined): KnownError | 'unknown' =>
  (KNOWN_ERRORS as readonly string[]).includes(code ?? '') ? (code as KnownError) : 'unknown';

/** مفتاح منع تكرار جديد لكل **محاولة نموذج** (يبقى ثابتاً عند إعادة الإرسال نفسه بعد انقطاع). */
export function newIdempotencyKey(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `refund-${rand}`;
}

/** تخصيص تلقائي بالترتيب (الأقدم أولاً) على المصادر المؤهَّلة حتى يُغطّى المبلغ؛ يعيد `null` إن لم تكفِ المصادر. */
export function autoAllocate(sources: EligibleSource[], amountMinor: number): { source_type: string; source_id: string; amount_minor: number }[] | null {
  let left = amountMinor;
  const out: { source_type: string; source_id: string; amount_minor: number }[] = [];
  for (const s of [...sources].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))) {
    if (left <= 0) break;
    const take = Math.min(left, s.refundable);
    if (take > 0) {
      out.push({ source_type: s.source_type, source_id: s.id, amount_minor: take });
      left -= take;
    }
  }
  return left === 0 && out.length > 0 ? out : null;
}

export const maxRefundable = (ctx: Pick<RefundContext, 'refundable_minor' | 'sources'>): number =>
  Math.min(ctx.refundable_minor, ctx.sources.reduce((sum, s) => sum + s.refundable, 0));

/** ريال → هللات بلا float: نص عشري بخانتين كحد أقصى؛ غير الصالح `null`. */
export function parseMajorToMinor(input: string): number | null {
  const text = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return minor > 0 ? minor : null;
}
