import { riyalToMinor } from '@/lib/money';
import { getCurrency } from '../constants/currencies';
import type { CurrencyCode, Direction, DocumentModel, DocumentTotals } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';

/** أشكال مصدر الإشعار الدائن (عقد الـ API) — المبالغ بالريال نصّاً. */
export interface SourceCreditNoteLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  /** قبل الضريبة (اختياري للتوافق مع إشعارات قديمة): يجعل سعر الوحدة والضريبة والإجمالي متطابقة في الطباعة. */
  unit_price_before_tax?: string | null;
  /** نسبة الضريبة المخزَّنة للسطر (15 = 15%). */
  tax_rate?: number | null;
  /** قبل الخصم وقبل الضريبة. */
  line_subtotal?: string | null;
  /** خصم السطر + حصته من خصم الرأس؛ غائب في حمولات الإشعارات السابقة. */
  line_discount?: string | null;
  line_tax: string;
  line_total: string;
}
export interface SourceCreditNote {
  number: string;
  note_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  reason?: string | null;
  /** إشعار مبيعات دائن أو إشعار مشتريات مدين؛ يحدد دلالة الطرف في القالب. */
  type?: 'sales' | 'purchase';
  lines: SourceCreditNoteLine[];
}

function optionalMinor(value: string | null | undefined): number | null {
  return value === null || value === undefined || value === '' ? null : riyalToMinor(value);
}

/**
 * يسوّي سطراً من مبالغه المخزَّنة فقط — لا يُشتق مبلغ من سعر وحدة مقرَّب ولا يُخترع خصم:
 *  - الصافي = line_subtotal − line_discount متى تطابق مع (الإجمالي − الضريبة) بالهللة.
 *  - حمولة قديمة بلا line_discount: يثبت الخصم صفراً فقط إن كان line_subtotal + الضريبة = الإجمالي.
 *  - غير ذلك: الصافي = الإجمالي − الضريبة (هوية مخزَّنة)، والخصم مجهول (`null`) ولا يُفترض.
 */
function reconcileLine(l: SourceCreditNoteLine) {
  const tax = riyalToMinor(l.line_tax);
  const total = riyalToMinor(l.line_total);
  const gross = optionalMinor(l.line_subtotal);
  const storedDiscount = optionalMinor(l.line_discount);

  let net = total - tax;
  let discount: number | null = null;
  if (gross !== null && storedDiscount !== null && gross - storedDiscount === net) {
    discount = storedDiscount;
  } else if (gross !== null && storedDiscount === null && gross === net) {
    discount = 0;
  }

  const stored = riyalToMinor(l.unit_price);
  const storedBeforeTax = optionalMinor(l.unit_price_before_tax);
  // إشعار سابق بلا سعر قبل الضريبة: سعره كان قبل الضريبة دوماً؛ يُعتمد فقط حين يثبته مبلغ السطر.
  const beforeTax = storedBeforeTax ?? (gross !== null && l.quantity * stored === gross ? stored : null);
  const unitPrice = beforeTax ?? stored;
  // الإجمالي قبل الخصم = الصافي + الخصم؛ إن لم يطابق الكمية × السعر المعروض فالفرق تقريب عرض.
  const unitPriceRounded = discount !== null && l.quantity * unitPrice !== net + discount;
  const rate = l.tax_rate === null || l.tax_rate === undefined ? null : Number(l.tax_rate);

  return {
    id: l.id,
    description: l.description ?? '',
    quantity: l.quantity,
    unitPrice,
    priceBeforeTax: beforeTax,
    discount,
    netAmount: net,
    taxRate: rate !== null && Number.isFinite(rate) ? rate : null,
    unitPriceRounded,
    tax,
    total,
  };
}

/**
 * إجماليات الطباعة. `note.subtotal` المخزَّن صافٍ بعد الخصم، فعرض صف خصم تحته يعدّ الخصم
 * مرتين. حين تثبت الهويات كلها بالهللة (Σ الصافي = المجموع، Σ الضريبة = الضريبة،
 * المجموع + الضريبة = الإجمالي) يُعرض المجموع قبل الخصم ثم الخصم الإجمالي صراحةً
 * (المجموع − الخصم = المخزَّن). وإلا تُطبع الإجماليات المخزَّنة كما هي بلا صف خصم مختلَق.
 */
function buildTotals(note: SourceCreditNote, lines: ReturnType<typeof reconcileLine>[]): DocumentTotals {
  const subtotal = riyalToMinor(note.subtotal);
  const tax = riyalToMinor(note.tax_amount);
  const total = riyalToMinor(note.total);

  const rates = new Set(lines.map((l) => l.taxRate));
  const taxRate = lines.length === 0 || rates.has(null) ? undefined : rates.size === 1 ? [...rates][0] : null;
  const base: DocumentTotals = { subtotal, tax, total, ...(taxRate === undefined ? {} : { taxRate }) };

  const discounts = lines.map((l) => l.discount);
  if (lines.length === 0 || discounts.some((d) => d === null)) return base;

  const totalDiscount = discounts.reduce<number>((sum, d) => sum + (d ?? 0), 0);
  const reconciles = lines.reduce((sum, l) => sum + l.netAmount, 0) === subtotal
    && lines.reduce((sum, l) => sum + l.tax, 0) === tax
    && subtotal + tax === total;

  return totalDiscount > 0 && reconciles
    ? { ...base, subtotal: subtotal + totalDiscount, discount: totalDiscount }
    : base;
}

/** يبني `DocumentModel` من إشعار دائن (النوع `credit_note`) — يعيد استخدام نفس القوالب. */
export function buildCreditNoteDocumentModel(input: {
  note: SourceCreditNote;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
  direction?: Direction;
}): DocumentModel {
  const { note, company, customer, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl } = input;
  const currency = getCurrency(company?.currency).code as CurrencyCode;
  const lines = note.lines.map(reconcileLine);
  const totals = buildTotals(note, lines);

  return {
    type: note.type === 'purchase' ? 'debit_note' : 'credit_note',
    currency,
    direction: input.direction ?? 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : (company?.logo ?? null),
      logoHeight: logoHeight ?? null,
    },
    buyer: {
      name: customer?.name ?? '—',
      vatNumber: customer?.vat_number ?? null,
      city: customer?.city ?? null,
    },
    meta: { number: note.number, date: note.note_date, dueDate: null, paymentType: null },
    lines,
    totals,
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: note.reason ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
