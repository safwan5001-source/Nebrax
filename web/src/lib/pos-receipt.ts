import type { SourceInvoice, SourceCustomer } from '@/modules/documents/builder/from-invoice';

/**
 * R5: يطابق حرفياً ما يعيده `InvoiceResource` بعد `POST /pos/checkout` — نفس
 * الفاتورة المرحّلة التي تعيدها `GET /invoices/{id}` لاحقاً لإعادة الطباعة.
 * الإيصال الفوري يُبنى من هذا الشكل وحده؛ لا يُعاد اشتقاق أي رقم مالي من سلة
 * العميل بعد نجاح الإتمام.
 */
export interface PosCheckoutInvoiceLine {
  id: string;
  product_name?: string | null;
  description: string | null;
  quantity: number;
  unit_price: string;
  unit_price_before_tax?: string | null;
  tax_rate: number;
  line_tax: string;
  line_total: string;
}
export interface PosCheckoutInvoice {
  number: string;
  invoice_date: string;
  payment_status?: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes: string | null;
  partner?: { name: string; vat_number: string | null; city: string | null } | null;
  lines: PosCheckoutInvoiceLine[];
}

/**
 * يبني نموذج الإيصال من الفاتورة المرحّلة الخادمية وحدها. `cartUnits` عنصر
 * عرض بحت فقط (اسم الوحدة البديلة التي اختارها الكاشير في الشاشة، بترتيب
 * سطور السلة نفسه) — يُلحَق بنص الوصف للعرض، ولا يغيّر أي رقم مالي: الكمية
 * والسعر والضريبة والإجماليات كلها من `created` حصراً.
 */
export function buildPosReceiptInvoice(
  created: PosCheckoutInvoice,
  cartUnits: ReadonlyArray<string | null | undefined> = [],
): SourceInvoice {
  return {
    number: created.number,
    invoice_date: created.invoice_date,
    // «آجل» في عقد الفاتورة يصف تصنيف المستند (كل بيع POS فاتورة آجلة تُسدَّد
    // بسندات قبض)؛ عرض الإيصال يحتاج حالة السداد الفعلية بعد الترحيل، وهي
    // `payment_status` وحدها — لا تُشتق من تحصيل الشاشة.
    payment_type: created.payment_status === 'unpaid' ? 'credit' : 'cash',
    subtotal: created.subtotal,
    tax_amount: created.tax_amount,
    total: created.total,
    notes: created.notes,
    lines: created.lines.map((line, index) => {
      const unit = cartUnits[index];
      const base = line.description ?? line.product_name ?? null;

      return {
        id: line.id,
        description: unit && base ? `${base} (${unit})` : base,
        quantity: line.quantity,
        unit_price: line.unit_price,
        unit_price_before_tax: line.unit_price_before_tax ?? null,
        tax_rate: line.tax_rate,
        line_tax: line.line_tax,
        line_total: line.line_total,
      };
    }),
  };
}

/** عميل الإيصال من `partner` الفاتورة المرحّلة؛ يسقط على اسم منتقي الشاشة فقط حين تغيب العلاقة (توافق رجعي). */
export function posReceiptCustomer(
  created: { partner?: { name: string; vat_number: string | null; city: string | null } | null },
  fallbackName: string,
): SourceCustomer {
  return created.partner
    ? { name: created.partner.name, vat_number: created.partner.vat_number, city: created.partner.city }
    : { name: fallbackName, vat_number: null, city: null };
}
