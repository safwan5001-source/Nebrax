import { ApiError } from '@/lib/api';

/**
 * عقد واجهة أجهزة دفع POS (PAY-H6-UI-01) — أنواع ودوال نقية فقط، بلا شبكة.
 * مرآة `PosPaymentTerminalResource` و`PosTerminalRequestResource` (الخادم هو الحاسم: الإخفاء هنا ليس حدّاً أمنياً).
 * لا أسرار ولا PAN ولا مرجع مزوّد داخلي في أي استجابة؛ الواجهة لا تعرض RRN أصلاً.
 */

/** إدارة الأجهزة (إنشاء/تعديل) — مرآة مسارات `company.manage`. */
export const MANAGE_PERMISSION = 'company.manage';
/** استعمال الجهاز في البيع (قراءة الأجهزة، إنشاء/استعلام/إلغاء الطلب) — مرآة `invoices.manage`. */
export const USE_PERMISSION = 'invoices.manage';

export const REQUEST_STATUSES = [
  'created', 'sent', 'approved', 'declined', 'cancelled', 'expired', 'error',
  'consumed', 'voided', 'compensation_required', 'compensated',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface PosPaymentTerminal {
  id: string;
  name: string;
  code: string | null;
  provider: string;
  /** محاكاة (محوّل fake): تُعرض صراحةً ولا تُقدَّم كدفع حقيقي أبداً. */
  simulated: boolean;
  pos_device_id: string | null;
  is_active: boolean;
  created_at: string | null;
}

export interface TerminalProvider { key: string; simulated: boolean }

export interface PosTerminalRequest {
  id: string;
  pos_session_id: string;
  pos_payment_terminal_id: string;
  payment_method_id: string;
  /** بالريال (نص/رقم من الخادم)؛ التحويل للهللات عبر `riyalToMinor` في طبقة العرض. */
  amount: number | string;
  currency: string;
  status: RequestStatus;
  approval_code: string | null;
  rrn: string | null;
  last4: string | null;
  failure_code: string | null;
  void_attempts: number;
  last_void_error: string | null;
  consumed_payment_id: string | null;
  consumed_invoice_id: string | null;
  resolution_note: string | null;
  approved_at: string | null;
  consumed_at: string | null;
  voided_at: string | null;
  resolved_at: string | null;
  created_at: string | null;
  idempotent_replay: boolean;
}

export interface TerminalBlockers { compensation_required: number; in_flight: number }

export type BadgeTone = 'neutral' | 'muted' | 'positive' | 'warning' | 'negative';

const IN_FLIGHT: readonly RequestStatus[] = ['created', 'sent'];
/** حالات نهائية لا تحجز الجهاز ولا تمنع إعادة المحاولة. */
const RETRYABLE: readonly RequestStatus[] = ['declined', 'cancelled', 'expired', 'error', 'voided'];

/** بانتظار العميل على الجهاز (لم يُحسم بعد). */
export function isPending(status: RequestStatus): boolean {
  return IN_FLIGHT.includes(status);
}
export function isApproved(status: RequestStatus): boolean {
  return status === 'approved';
}
export function needsCompensation(status: RequestStatus): boolean {
  return status === 'compensation_required';
}
/** تنتهي بلا أثر مالي ويصحّ فتح طلب جديد بعدها. */
export function isRetryable(status: RequestStatus): boolean {
  return RETRYABLE.includes(status);
}
/** تحجز مبلغ الدفع وتمنع الخروج من شاشة الدفع/تعديل المبلغ: معلّق أو موافقة قائمة أو تعويض لم يُحل. */
export function holdsPayment(status: RequestStatus): boolean {
  return isPending(status) || isApproved(status) || needsCompensation(status);
}

export function statusTone(status: RequestStatus): BadgeTone {
  switch (status) {
    case 'approved':
    case 'consumed':
      return 'positive';
    case 'created':
    case 'sent':
      return 'neutral';
    case 'compensation_required':
    case 'error':
    case 'declined':
      return 'negative';
    case 'expired':
    case 'voided':
      return 'warning';
    default:
      return 'muted';
  }
}

/** أجهزة صالحة لجلسة هذا الجهاز: نشطة، والمخصَّص منها لجهاز POS آخر مستبعد (الخادم يرفضه أيضاً). غير المخصَّص متاح لأي جهاز في الفرع. */
export function usableTerminals(terminals: readonly PosPaymentTerminal[], posDeviceId: string | null): PosPaymentTerminal[] {
  return terminals.filter((terminal) => terminal.is_active && (terminal.pos_device_id === null || terminal.pos_device_id === posDeviceId));
}

export function totalBlockers(blockers: TerminalBlockers | null | undefined): number {
  return blockers ? blockers.compensation_required + blockers.in_flight : 0;
}

/** رمز `reason` من استجابة خطأ الخادم (إن وُجد). */
export function reasonOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { reason?: unknown } | null | undefined;
  return typeof body?.reason === 'string' ? body.reason : null;
}

/** أسباب الخادم المعروفة التي لها نص مترجم تحت `posTerminals.errors.<reason>`. */
export const KNOWN_REASONS = [
  'terminal_busy', 'idempotency_conflict', 'operation_in_progress', 'terminal_unavailable_now', 'terminal_unavailable',
  'terminal_device_mismatch', 'provider_unavailable', 'adapter_unavailable', 'method_not_card', 'method_not_allowed_in_pos',
  'session_forbidden', 'invalid_amount', 'not_cancellable', 'not_voidable', 'compensation_in_progress',
] as const;
export type KnownReason = (typeof KNOWN_REASONS)[number];

export function knownReason(reason: string | null): KnownReason | null {
  return reason !== null && (KNOWN_REASONS as readonly string[]).includes(reason) ? (reason as KnownReason) : null;
}

/** رموز فشل/إلغاء معروفة (من المحوّل) لها نص مترجم تحت `posTerminals.failure.<code>`. */
export const KNOWN_FAILURES = ['declined', 'amount_mismatch', 'start_unconfirmed', 'void_failed', 'void_not_confirmed', 'void_rejected'] as const;
export function knownFailure(code: string | null): string | null {
  return code !== null && (KNOWN_FAILURES as readonly string[]).includes(code) ? code : null;
}

/**
 * ملخص تصعيد آمن للنسخ إلى المدير: معرّف مختصر ومبلغ وحالة ووقت فقط —
 * بلا رمز موافقة ولا RRN ولا آخر 4 أرقام ولا أي مرجع مزوّد.
 */
export function escalationSummary(request: Pick<PosTerminalRequest, 'id' | 'amount' | 'status' | 'created_at' | 'void_attempts'>, terminalName: string | null): string {
  const short = request.id.replace(/-/g, '').slice(-8);
  return [
    `ref:${short}`,
    `status:${request.status}`,
    `amount:${request.amount}`,
    `attempts:${request.void_attempts}`,
    terminalName ? `terminal:${terminalName}` : null,
    request.created_at ? `at:${request.created_at}` : null,
  ].filter((part): part is string => part !== null).join(' | ');
}

/** معرّف مفتاح idempotency لمحاولة دفع: يتجدد عند تغيّر المحتوى (مبلغ/جهاز/وسيلة) فلا يصطدم بـ`idempotency_conflict`. */
export function attemptFingerprint(parts: { sessionId: string; terminalId: string; methodId: string; amountMinor: number }): string {
  return `${parts.sessionId}|${parts.terminalId}|${parts.methodId}|${parts.amountMinor}`;
}
