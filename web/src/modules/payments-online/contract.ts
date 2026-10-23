import type { BadgeTone } from '@/modules/payments/gateways/contract';
import { attemptPhase, phaseTone, type AttemptPhase } from '@/modules/invoice-payment-requests/contract';

/**
 * عقد سجل «الدفعات الإلكترونية» (PAY-H2-03c) — أنواع ودوال نقية بلا شبكة. مرآة `PaymentAttemptLogController`
 * (قراءة فقط: `GET /payment-attempts` و`GET /payment-attempts/{id}`) و`POST /payment-attempts/{id}/repost`.
 * الخادم هو الحاسم؛ إخفاء الإجراء هنا راحة لا حدّ أمني. لا رمز عام ولا `body` ولا أسرار تصل إلى هذه الأنواع.
 */

export const VIEW_PERMISSION = 'payments.view';
export const RESOLVE_PERMISSION = 'payments.resolve_blocked';

export interface AttemptRow {
  id: string;
  request_id: string;
  invoice: { id: string; number: string | null } | null;
  gateway: { id: string; name: string; provider: string; environment: string } | null;
  capture_status: string;
  posting_status: string | null;
  amount_minor: number;
  captured_minor: number;
  currency: string;
  review_reasons: string[];
  blocked_reason: { kind?: string; [key: string]: unknown } | null;
  accounting_date: string | null;
  captured_at: string | null;
  posted_at: string | null;
  created_at: string | null;
}

export interface AttemptPosting {
  role: 'allocated' | 'excess';
  amount_minor: number;
  payment_id: string;
  payment_number: string | null;
}

export type TimelineEvent =
  | { type: 'created' | 'captured' | 'posted'; at: string | null }
  | { type: 'provider_event'; at: string | null; event_type: string | null; outcome: string | null }
  | { type: 'repost'; at: string | null; outcome: 'posted' | 'still_blocked'; actor: string | null; reason: string };

export interface AttemptDetail extends AttemptRow {
  failure_code: string | null;
  refunded_minor: number;
  postings: AttemptPosting[];
  timeline: TimelineEvent[];
}

export interface ListMeta { total: number; page: number; per_page: number; last_page: number }

/** تبويبات السجل: الكل، المحجوب بفترة مقفلة، ما يحتاج مراجعة. */
export const TABS = ['all', 'blocked', 'review'] as const;
export type TabKey = (typeof TABS)[number];

export const CAPTURE_STATUSES = ['created', 'pending_customer', 'authorized', 'captured', 'cancelled', 'expired', 'failed', 'voided'] as const;

export interface LogFilters { tab: TabKey; captureStatus: string; page: number; perPage: number }

export function buildListQuery(f: LogFilters): string {
  const q = new URLSearchParams();
  q.set('page', String(f.page));
  q.set('per_page', String(f.perPage));
  if (f.tab === 'blocked') q.set('posting_status', 'blocked_period');
  if (f.tab === 'review') q.set('needs_review', '1');
  if (f.tab === 'all' && f.captureStatus) q.set('capture_status', f.captureStatus);
  return q.toString();
}

/** مرحلة الصف بلغة الإدارة — نفس منطق قسم الفاتورة (03b) لتتطابق الحالات في الشاشتين. */
export function rowPhase(row: Pick<AttemptRow, 'capture_status' | 'posting_status' | 'review_reasons' | 'amount_minor' | 'captured_minor'>): AttemptPhase {
  return attemptPhase({
    id: '', capture_status: row.capture_status, posting_status: row.posting_status, review_reasons: row.review_reasons,
    amount_minor: row.amount_minor, captured_minor: row.captured_minor, checkout_url: null,
  });
}

export const rowTone = (row: Parameters<typeof rowPhase>[0]): BadgeTone => phaseTone(rowPhase(row));

/** إعادة الترحيل متاحة فقط للمحجوب بفترة/سنة مقفلة ولمن يملك الصلاحية. */
export const canRepost = (row: Pick<AttemptRow, 'posting_status'>, allowed: boolean): boolean => allowed && row.posting_status === 'blocked_period';

export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const reasonValid = (reason: string): boolean => reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;

export const REVIEW_REASONS = ['overpayment', 'late_capture', 'amount_mismatch', 'currency_mismatch', 'state_conflict'] as const;
export const knownReviewReason = (r: string): (typeof REVIEW_REASONS)[number] | 'other' =>
  (REVIEW_REASONS as readonly string[]).includes(r) ? (r as (typeof REVIEW_REASONS)[number]) : 'other';

/** سبب الحجب: `period` (فترة مقفلة) أو `year` (سنة مالية مقفلة)؛ غيرهما يُعرض عاماً. */
export const blockedKind = (row: Pick<AttemptRow, 'blocked_reason'>): 'period' | 'year' | 'other' =>
  row.blocked_reason?.kind === 'period' ? 'period' : row.blocked_reason?.kind === 'year' ? 'year' : 'other';

export const REPOST_ERRORS = ['forbidden', 'not_blocked', 'not_postable', 'reason_required'] as const;
export const knownRepostError = (code: string | null): (typeof REPOST_ERRORS)[number] | 'unknown' =>
  (REPOST_ERRORS as readonly string[]).includes(code ?? '') ? (code as (typeof REPOST_ERRORS)[number]) : 'unknown';

export interface RepostResult { id: string; outcome: 'posted' | 'blocked_period' | string; posting_status: string }

/** نتيجة معالجة حدث المزوّد كما يسجّلها الخادم؛ غيرها (أو غيابها) لا تُعرض. */
export const PROVIDER_OUTCOMES = ['applied', 'duplicate', 'stale', 'state_conflict', 'attempt_not_found'] as const;
export type ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];
export const knownProviderOutcome = (outcome: string | null | undefined): ProviderOutcome | 'other' | null =>
  outcome == null || outcome === '' ? null : (PROVIDER_OUTCOMES as readonly string[]).includes(outcome) ? (outcome as ProviderOutcome) : 'other';

/** `applied` عادي؛ المكرَّر/القديم مُهمَل بلا أثر؛ التعارض وعدم وجود المحاولة يحتاجان انتباهاً. */
export const providerOutcomeTone = (outcome: ProviderOutcome | 'other'): BadgeTone =>
  outcome === 'applied' ? 'neutral' : outcome === 'state_conflict' || outcome === 'attempt_not_found' ? 'warning' : 'muted';
