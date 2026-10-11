import { riyalToMinor } from '@/lib/money';
import { sourceLineAmounts, type SourceCharge } from '@/components/returns/source-line-amounts';

/**
 * منطق الإشعار الدائن المرتبط بفاتورة — نقيّ بلا React ولا شبكة.
 * الخادم هو الحَكَم عند الإنشاء؛ هذه الوحدة تمنع الرفض الواضح مسبقاً وتعاين
 * المبالغ بالمُخصِّص نفسه (`sourceLineAmounts`) — لا حساب توزيع ثانٍ هنا.
 */

/** سطر قابل للردّ كما يعيده `GET /returns/returnable/sales/{id}` (المبالغ ريال نصّاً). */
export interface ReturnableLine {
  source_line_id: string;
  product_id: string | null;
  description: string | null;
  quantity: number;
  returned: number;
  remaining: number;
  unit_price: string;
  tax_rate: number;
  unit_price_before_tax?: string;
  charged_net: string;
  charged_tax: string;
  remaining_net: string;
  remaining_tax: string;
  reduced_price_returned?: boolean;
}

export interface ReturnableInvoice {
  id: string;
  number: string;
  partner_id: string;
  tax_inclusive: boolean;
  date: string | null;
  fully_returned: boolean;
  lines: ReturnableLine[];
}

/** فاتورة مرحَّلة كمصدر محتمل (`GET /returns/sources/sales`). */
export interface SourceInvoice {
  id: string;
  number: string;
  date: string | null;
  total: string;
  remaining: number;
  blocked_reason: string | null;
  elapsed_days: number;
}

/** مدخل المستخدم لسطر: الفراغ في الكمية = 0، والفراغ في السعر = سعر الفاتورة. */
export interface LineInput { quantity: string; price: string }

export type LineErrorCode = 'qty_invalid' | 'qty_above_remaining' | 'price_invalid' | 'price_above_invoice';

export interface LineEvaluation {
  quantity: number;
  /** السعر المعتمد للمعاينة والإرسال (هللات). */
  priceMinor: number;
  invoicePriceMinor: number;
  /** السعر المُدخل أقل من سعر الفاتورة (إشعار جزئي) فيُرسَل `unit_price`. */
  priceLowered: boolean;
  error: LineErrorCode | null;
  net: number;
  tax: number;
  total: number;
}

const BLOCKED_KEYS: Record<string, string> = {
  fully_returned: 'blocked_fully_returned',
  out_of_window: 'blocked_out_of_window',
  legacy_credit_review: 'blocked_legacy_credit_review',
};

/** مفتاح ترجمة سبب المنع؛ سببٌ لا نعرفه (خادمٌ أحدث) يسقط على رسالة عامة. null = غير ممنوعة. */
export function blockedReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return BLOCKED_KEYS[reason] ?? 'blocked_generic';
}

/** محصَّل السطر كما يطلبه مُخصِّص المعاينة — نفس تحويل `create-return-dialog`. */
export function toCharge(line: ReturnableLine): SourceCharge {
  return {
    soldQty: line.quantity,
    returnedQty: line.returned,
    unitPrice: riyalToMinor(line.unit_price),
    net: riyalToMinor(line.charged_net),
    tax: riyalToMinor(line.charged_tax),
    remainingNet: riyalToMinor(line.remaining_net),
    remainingTax: riyalToMinor(line.remaining_tax),
    reducedBefore: !!line.reduced_price_returned,
  };
}

export const emptyInput = (): LineInput => ({ quantity: '', price: '' });

export function evaluateLine(line: ReturnableLine, input: LineInput | undefined): LineEvaluation {
  const invoicePriceMinor = riyalToMinor(line.unit_price);
  const base: LineEvaluation = {
    quantity: 0, priceMinor: invoicePriceMinor, invoicePriceMinor, priceLowered: false,
    error: null, net: 0, tax: 0, total: 0,
  };

  const qtyText = (input?.quantity ?? '').trim();
  if (qtyText === '') return base;
  const quantity = Number(qtyText);
  if (!Number.isInteger(quantity) || quantity < 0) return { ...base, error: 'qty_invalid' };
  if (quantity === 0) return base;
  if (quantity > line.remaining) return { ...base, quantity, error: 'qty_above_remaining' };

  const priceText = (input?.price ?? '').trim();
  let priceMinor = invoicePriceMinor;
  if (priceText !== '') {
    priceMinor = riyalToMinor(priceText);
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) return { ...base, quantity, error: 'price_invalid' };
    // يُخفَّض السعر ولا يُرفع: الخادم يتجاهل الرفع أو يرفضه، فنمنعه هنا بوضوح.
    if (priceMinor > invoicePriceMinor) return { ...base, quantity, priceMinor, error: 'price_above_invoice' };
  }

  const { net, tax } = sourceLineAmounts(toCharge(line), quantity, priceMinor);
  return {
    quantity, priceMinor, invoicePriceMinor,
    priceLowered: priceMinor < invoicePriceMinor,
    error: null, net, tax, total: net + tax,
  };
}

export interface LinkedSummary {
  evaluations: Record<string, LineEvaluation>;
  /** عدد السطور ذات الكمية > 0. */
  itemCount: number;
  hasErrors: boolean;
  net: number;
  tax: number;
  total: number;
}

export function summarize(lines: ReturnableLine[], inputs: Record<string, LineInput>): LinkedSummary {
  const evaluations: Record<string, LineEvaluation> = {};
  let itemCount = 0; let hasErrors = false; let net = 0; let tax = 0;
  for (const line of lines) {
    // سطر بلا متبقٍّ معطَّل: لا يدخل الإرسال مهما بقي في الحالة.
    const e = line.remaining > 0 ? evaluateLine(line, inputs[line.source_line_id]) : evaluateLine(line, undefined);
    evaluations[line.source_line_id] = e;
    if (e.error) hasErrors = true;
    if (!e.error && e.quantity > 0) { itemCount += 1; net += e.net; tax += e.tax; }
  }
  return { evaluations, itemCount, hasErrors, net, tax, total: net + tax };
}

export interface LinkedBodyInput {
  partnerId: string;
  invoiceId: string;
  refundType: string;
  noteDate: string;
  reason: string;
  lines: ReturnableLine[];
  inputs: Record<string, LineInput>;
}

export interface LinkedItem { source_line_id: string; quantity: number; unit_price?: number }

/**
 * جسم `POST /credit-notes` للإشعار المرتبط. لا يُرسَل نوع ولا نسبة ضريبة ولا منتج:
 * الخادم يشتقّها من سطر الفاتورة. `unit_price` (هللات) يُرسَل فقط حين يُخفَّض السعر.
 */
export function buildLinkedBody(i: LinkedBodyInput) {
  const { evaluations } = summarize(i.lines, i.inputs);
  const items: LinkedItem[] = [];
  for (const line of i.lines) {
    const e = evaluations[line.source_line_id];
    if (e.error || e.quantity <= 0) continue;
    items.push(e.priceLowered
      ? { source_line_id: line.source_line_id, quantity: e.quantity, unit_price: e.priceMinor }
      : { source_line_id: line.source_line_id, quantity: e.quantity });
  }
  return {
    partner_id: i.partnerId,
    original_invoice_id: i.invoiceId,
    refund_type: i.refundType,
    note_date: i.noteDate || null,
    reason: i.reason || null,
    items,
  };
}
