import type { BadgeTone } from '@/modules/payments/gateways/contract';

/**
 * عقد واجهة «تسويات البوابة وتعديلات المزوّد» (PAY-H3-02d) — أنواع ودوال نقية بلا شبكة. مرآة `PaymentGatewaySettlementController`
 * و`PaymentGatewayAdjustmentController` (ADR-0008). الخادم هو الحاسم في كل قرار؛ إخفاء الإجراء هنا راحة لا حدّ أمني.
 * المبالغ بالهللات. **الواجهة لا تُفعّل ضريبة المدخلات (`tax_input`) ولا تضبط سياستها**: تعرض حقولها فقط إن فتحها الخادم (D-04).
 */

export const VIEW_PERMISSION = 'payments.view';
export const MANAGE_PERMISSION = 'payment_settlements.manage';
export const ADJUST_PERMISSION = 'payment_settlements.adjust';
export const APPROVE_ADJUSTMENT_PERMISSION = 'payment_settlements.approve_adjustment';
export const VIEW_REFUNDS_PERMISSION = 'payment_refunds.view';

export const REASON_MIN = 5;
export const REASON_MAX = 500;
export const EVIDENCE_MIN = 3;
export const EVIDENCE_MAX = 191;
export const reasonValid = (reason: string): boolean => reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
export const evidenceValid = (evidence: string): boolean => evidence.trim().length >= EVIDENCE_MIN && evidence.trim().length <= EVIDENCE_MAX;

// ───────────────────────── التسويات ─────────────────────────

export const SETTLEMENT_STATUSES = ['posted', 'unreconciled'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export interface SettlementRow {
  id: string;
  payment_gateway_id: string;
  gateway_name: string | null;
  provider_settlement_ref: string;
  settlement_date: string | null;
  status: SettlementStatus;
  currency: string;
  gross_amount: number;
  net_bank_amount: number;
  provider_fee_ex_tax: number;
  provider_fee_tax: number;
  provider_deductions: number;
  provider_credits: number;
  refunds_total: number;
  /** فرق موقَّع غير صفري للمسودة `unreconciled` وإلا `null`. */
  unreconciled_minor: number | null;
  journal_entry_id: string | null;
  posted_at: string | null;
}

export interface SettlementItem { payment_id: string; provider_event_ref: string | null; gross_amount: number }

export const LINE_TYPES = ['refund', 'reserve_hold', 'reserve_release', 'adjustment_debit', 'adjustment_credit'] as const;
export interface SettlementLine {
  line_type: string;
  adjustment_id: string | null;
  evidence_ref: string | null;
  payment_refund_id: string | null;
  refund_number: string | null;
  amount_minor: number;
  provider_event_ref: string | null;
}

export interface SettlementDetail extends SettlementRow { items: SettlementItem[]; lines: SettlementLine[] }

export interface PreviewBlocker { code: string; message: string }
export interface SettlementPreview {
  gross: number | null;
  refunds_total: number | null;
  net_bank_amount: number;
  provider_fee_ex_tax: number;
  provider_fee_tax: number;
  provider_deductions: number;
  provider_credits: number;
  adjustments_deductions: number | null;
  adjustments_credits: number | null;
  /** المتوقع − المُدخَل (موجب: الصافي المُدخَل أقل من المتوقع). `null` حين يتعذّر الحساب. */
  difference: number | null;
  reconciled: boolean;
  postable: boolean;
  saveable_as_unreconciled: boolean;
  replay: boolean;
  existing_status: SettlementStatus | null;
  blockers: PreviewBlocker[];
}

export interface UnsettledPayment { payment_id: string; number: string | null; date: string | null; amount: number; settled: number; remaining: number; partner_id: string | null }
export interface UnsettledRefund {
  refund_id: string; number: string | null; amount: number; deducted: number; remaining: number; partner_id: string | null; currency: string; accounting_date: string | null;
}

export interface ListMeta { total: number; page: number; per_page: number; last_page: number }
export interface MoreMeta { page: number; per_page: number; has_more: boolean }

export type Primary = 'post' | 'unreconciled' | null;

/** الزرّ الأساسي من المعاينة وحدها: ترحيل إن كانت قابلة للترحيل، وإلا حفظ مسودة غير مطابقة إن سمح الخادم، وإلا لا شيء. */
export function primaryAction(preview: SettlementPreview | null): Primary {
  if (preview === null) return null;
  if (preview.postable) return 'post';
  if (preview.saveable_as_unreconciled) return 'unreconciled';
  return null;
}

export function settlementTone(status: SettlementStatus): BadgeTone {
  return status === 'posted' ? 'positive' : 'warning';
}

/** نبرة الفرق: صفر = مطابقة، وغيره تحذير. `null` (لا حساب) محايد. */
export function differenceTone(difference: number | null): BadgeTone {
  if (difference === null) return 'muted';
  return difference === 0 ? 'positive' : 'warning';
}

/** معادلة A6 كما يطبّقها الخادم: المتوقع = إجمالي التحصيل − الاستردادات − العمولة − ضريبتها − خصومات التعديلات + دائناتها. */
export function expectedNet(p: Pick<SettlementPreview, 'gross' | 'refunds_total' | 'provider_fee_ex_tax' | 'provider_fee_tax' | 'adjustments_deductions' | 'adjustments_credits'>): number | null {
  if (p.gross === null || p.refunds_total === null) return null;
  return p.gross - p.refunds_total - p.provider_fee_ex_tax - p.provider_fee_tax - (p.adjustments_deductions ?? 0) + (p.adjustments_credits ?? 0);
}

/** ريال → هللات بلا float؛ الصفر مسموح عند `allowZero`. غير الصالح `null`. */
export function parseMinor(input: string, allowZero = false): number | null {
  const text = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return minor > 0 || (allowZero && minor === 0) ? minor : null;
}

/** هللات → نص ريال قابل للتحرير (بلا فواصل). */
export function minorToInput(minor: number): string {
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

export interface PreviewInput {
  gatewayId: string;
  bankId: string;
  ref: string;
  date: string;
  netMinor: number | null;
  feeMinor: number;
  feeTaxMinor: number;
  feeTaxInvoiceRef: string;
  items: { payment_id: string; gross_amount: number }[];
  refunds: { payment_refund_id: string; amount_minor: number }[];
  adjustmentIds: string[];
}

/** جسم المعاينة/التسجيل، أو `null` إن نقص ما يمنع المعاينة أصلاً (بوابة/حساب بنك/مرجع/صافي، أو لا تحصيل ولا تعديل). حقول ضريبة الرسوم لا تُرسل إلا إن أُدخلت. */
export function buildSettlementBody(f: PreviewInput): Record<string, unknown> | null {
  if (!f.gatewayId || !f.bankId || f.ref.trim() === '' || f.netMinor === null) return null;
  if (f.items.length === 0 && f.adjustmentIds.length === 0) return null;
  const body: Record<string, unknown> = {
    payment_gateway_id: f.gatewayId,
    cash_bank_account_id: f.bankId,
    provider_settlement_ref: f.ref.trim(),
    net_bank_amount: f.netMinor,
    provider_fee_ex_tax: f.feeMinor,
  };
  if (f.date) body.settlement_date = f.date;
  if (f.feeTaxMinor > 0) {
    body.provider_fee_tax = f.feeTaxMinor;
    if (f.feeTaxInvoiceRef.trim() !== '') body.fee_tax_invoice_ref = f.feeTaxInvoiceRef.trim();
  }
  if (f.items.length > 0) body.items = f.items;
  if (f.refunds.length > 0) body.refunds = f.refunds;
  if (f.adjustmentIds.length > 0) body.adjustments = f.adjustmentIds.map((id) => ({ adjustment_id: id }));
  return body;
}

/** حقول ضريبة الرسوم تُعرض فقط حين فتح الخادم المسار فعلاً (سياسة `input_vat` **و**الرأي الضريبي مسجَّل). غير ذلك: مغلقة. */
export const feeTaxOpen = (g: { fee_tax_policy?: string | null; fee_tax_opinion_recorded?: boolean | null } | null | undefined): boolean =>
  g?.fee_tax_policy === 'input_vat' && g.fee_tax_opinion_recorded === true;

/** رموز الرفض/الحجب المعروفة لمسارَي التسويات والتعديلات (تُترجم في الواجهة)؛ غيرها يسقط إلى رسالة عامة. */
export const KNOWN_ERRORS = [
  'forbidden', 'rollout_disabled', 'operation_rejected', 'bank_account_forbidden', 'bank_account_inactive', 'bank_account_not_found', 'bank_ledger_account_group',
  'bank_ledger_account_inactive', 'credits_unsupported', 'currency_mismatch', 'deductions_unsupported', 'empty_settlement', 'fee_tax_not_authorized',
  'fee_tax_invoice_required', 'fee_tax_invoice_reused', 'gateway_not_found', 'invalid_adjustments', 'invalid_amount', 'invalid_items', 'invalid_refunds',
  'items_required', 'negative_net_unsupported', 'period_locked', 'reference_conflict', 'reference_required', 'role_unmapped', 'unreconciled_difference',
  'adjustment_not_approved', 'refund_not_posted', 'refund_after_settlement_date', 'reserve_insufficient',
  'adjustment_not_found', 'invalid_state', 'self_approval', 'duplicate_event', 'evidence_required', 'invalid_kind', 'reason_required',
] as const;
export type KnownError = (typeof KNOWN_ERRORS)[number];
export const knownError = (code: string | null | undefined): KnownError | 'unknown' =>
  (KNOWN_ERRORS as readonly string[]).includes(code ?? '') ? (code as KnownError) : 'unknown';

export function buildListQuery(f: { page: number; perPage: number; gatewayId?: string; status?: string; kind?: string }): string {
  const q = new URLSearchParams();
  q.set('page', String(f.page));
  q.set('per_page', String(f.perPage));
  if (f.gatewayId) q.set('payment_gateway_id', f.gatewayId);
  if (f.status) q.set('status', f.status);
  if (f.kind) q.set('kind', f.kind);
  return q.toString();
}

// ───────────────────────── التعديلات ─────────────────────────

export const ADJUSTMENT_KINDS = ['reserve_hold', 'reserve_release', 'adjustment_debit', 'adjustment_credit'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const ADJUSTMENT_STATUSES = ['requested', 'approved', 'rejected', 'cancelled', 'consumed'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/** أثر النوع على البنك (`PaymentGatewayAdjustment::BANK_SIGN`): احتجاز وخصم ينقصان الصافي، وإفراج ودائن يزيدانه. */
export const BANK_SIGN: Record<AdjustmentKind, -1 | 1> = { reserve_hold: -1, reserve_release: 1, adjustment_debit: -1, adjustment_credit: 1 };

export interface Actor { id: string; name: string | null }
export interface AdjustmentRow {
  id: string;
  payment_gateway_id: string;
  kind: AdjustmentKind;
  amount_minor: number;
  currency: string;
  status: AdjustmentStatus;
  reason: string;
  evidence_ref: string;
  provider_event_ref: string | null;
  requested_by: Actor | null;
  requested_at: string | null;
  approved_by: Actor | null;
  approved_at: string | null;
  rejected_by: Actor | null;
  reject_reason: string | null;
  cancelled_by: Actor | null;
  cancel_reason: string | null;
  settlement_id: string | null;
}
export interface AdjustmentTimelineEvent { action: string; from_status: string | null; to_status: string | null; actor: string | null; reason: string | null; at: string | null }
export interface AdjustmentDetail extends AdjustmentRow { timeline: AdjustmentTimelineEvent[] }
export interface ReserveBalance { held_minor: number; releasable_minor: number }

export function adjustmentTone(status: AdjustmentStatus): BadgeTone {
  if (status === 'approved' || status === 'consumed') return 'positive';
  if (status === 'requested') return 'warning';
  if (status === 'rejected') return 'negative';
  return 'muted';
}

/** الاعتماد/الرفض لمن يملك الصلاحية وهو **ليس** الطالب (الخادم والقاعدة يفرضان ذلك أيضاً). */
export const canApproveAdjustment = (row: Pick<AdjustmentRow, 'status' | 'requested_by'>, allowed: boolean, userId: string | null): boolean =>
  allowed && row.status === 'requested' && userId !== null && row.requested_by?.id !== userId;

/** الإلغاء قبل الاستهلاك للطالب نفسه أو لصاحب صلاحية الاعتماد (`PaymentGatewayAdjustmentService::cancel`). */
export const canCancelAdjustment = (row: Pick<AdjustmentRow, 'status' | 'requested_by'>, canApprove: boolean, userId: string | null): boolean =>
  (row.status === 'requested' || row.status === 'approved') && (canApprove || (userId !== null && row.requested_by?.id === userId));

/** تعديل معتمد غير مستهلَك في تسوية: وحده يصلح بنداً في تسجيل تسوية. */
export const selectableAdjustment = (row: Pick<AdjustmentRow, 'status' | 'settlement_id'>): boolean => row.status === 'approved' && row.settlement_id === null;
