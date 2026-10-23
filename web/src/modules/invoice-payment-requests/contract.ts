import type { BadgeTone, GatewayConnection } from '@/modules/payments/gateways/contract';

/**
 * عقد قسم «الدفع الإلكتروني» في الفاتورة (PAY-H2-03b) — أنواع ودوال نقية بلا شبكة. مرآة `InvoicePaymentRequestResource` (الخادم هو الحاسم:
 * الإخفاء هنا ليس حدّاً أمنياً). **الرمز الخام للرابط لا يُعاد إلا في ردّ الإصدار مرة واحدة**؛ الطلب يحمل مؤشر `link_issued` فقط.
 */

export type RequestStatus = 'open' | 'cancelled' | 'completed' | 'expired';

export interface OnlineAttempt {
  id: string;
  capture_status: string;
  amount_minor: number;
  captured_minor: number;
  posting_status: string | null;
  checkout_url: string | null;
  review_reasons: string[] | null;
}

export interface OnlineRequest {
  id: string;
  invoice_id: string;
  payment_gateway_id: string;
  status: RequestStatus;
  allow_partial: boolean;
  link_issued: boolean;
  currency: string;
  expires_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  latest_attempt: OnlineAttempt | null;
}

export const VIEW_PERMISSION = 'payments.view';
export const MANAGE_PERMISSION = 'payments.manage';

/** مزوّدون لهم محوّل دفع مستضاف فعلي على الخادم؛ `custom` ربطٌ محاسبي يدوي بلا محوّل فلا يصلح لرابط دفع. */
export const ONLINE_PROVIDERS: readonly string[] = ['moyasar'];

/** اتصالات تصلح لطلب دفع: مفعّلة، قابلة للاستعمال، متحقَّق منها، ولمزوّد له محوّل. */
export function usableGateways(gateways: readonly GatewayConnection[]): GatewayConnection[] {
  return gateways.filter((g) => g.status === 'active' && g.is_usable && g.verified_at !== null && ONLINE_PROVIDERS.includes(g.provider));
}

export const EXPIRY_OPTIONS = [
  { key: 'none', minutes: null },
  { key: 'd1', minutes: 24 * 60 },
  { key: 'd3', minutes: 3 * 24 * 60 },
  { key: 'd7', minutes: 7 * 24 * 60 },
  { key: 'd30', minutes: 30 * 24 * 60 },
] as const;
export type ExpiryKey = (typeof EXPIRY_OPTIONS)[number]['key'];

export function expiryMinutes(key: ExpiryKey): number | null {
  return EXPIRY_OPTIONS.find((o) => o.key === key)?.minutes ?? null;
}

export function statusTone(status: RequestStatus): BadgeTone {
  switch (status) {
    case 'open': return 'neutral';
    case 'completed': return 'positive';
    case 'expired': return 'warning';
    default: return 'muted';
  }
}

export const hasOpenRequest = (requests: readonly OnlineRequest[]): boolean => requests.some((r) => r.status === 'open');
export const canIssueLink = (r: Pick<OnlineRequest, 'status' | 'link_issued'>): boolean => r.status === 'open' && !r.link_issued;
export const canCancel = (r: Pick<OnlineRequest, 'status'>): boolean => r.status === 'open';

/**
 * حالة آخر محاولة بلغة الإدارة (لا حالة المزوّد الخام): مدفوع مرحَّل / مدفوع بانتظار الترحيل / مدفوع محجوب بفترة مقفلة / يحتاج مراجعة / بانتظار الدافع / لم يكتمل / لا محاولة.
 * المراجعة (مبلغ/عملة مختلف أو تعارض حالة) تغلب لأن الترحيل محتجَز لها.
 */
export type AttemptPhase = 'none' | 'awaiting' | 'posted' | 'posting_pending' | 'blocked_period' | 'review' | 'not_completed';

const HOLDING = ['amount_mismatch', 'currency_mismatch', 'state_conflict'];

export function attemptPhase(a: OnlineAttempt | null): AttemptPhase {
  if (a === null) return 'none';
  if (a.capture_status === 'captured') {
    if ((a.review_reasons ?? []).some((r) => HOLDING.includes(r))) return 'review';
    if (a.posting_status === 'posted') return 'posted';
    if (a.posting_status === 'blocked_period') return 'blocked_period';
    return 'posting_pending';
  }
  if (['created', 'pending_customer', 'authorized'].includes(a.capture_status)) return 'awaiting';
  return 'not_completed';
}

export function phaseTone(phase: AttemptPhase): BadgeTone {
  switch (phase) {
    case 'posted': return 'positive';
    case 'blocked_period': case 'review': return 'negative';
    case 'posting_pending': case 'awaiting': return 'warning';
    default: return 'muted';
  }
}

/** رابط الدفع الكامل للنسخ: أصل المتصفح + `/pay/{token}` (مسار صفحة الدافع). */
export function buildPayUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/pay/${token}`;
}

/** رموز أخطاء الخادم المعروفة لهذا القسم (للترجمة)؛ غيرها يسقط على `unknown`. */
export const KNOWN_ERRORS = [
  'open_request_exists', 'invoice_not_payable', 'partner_required', 'gateway_unavailable', 'gateway_unverified', 'rollout_disabled',
  'platform_stop', 'forbidden', 'request_not_open', 'request_expired', 'link_already_issued', 'payment_captured', 'invalid_expiry',
] as const;

export function knownError(code: string | null): (typeof KNOWN_ERRORS)[number] | 'unknown' {
  return (KNOWN_ERRORS as readonly string[]).includes(code ?? '') ? (code as (typeof KNOWN_ERRORS)[number]) : 'unknown';
}
