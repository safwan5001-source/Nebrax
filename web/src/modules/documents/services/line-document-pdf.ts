import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';
import {
  createInvoicePdf,
  downloadInvoicePdf,
  shareInvoicePdf,
  type InvoicePdfAdjustment,
  type InvoicePdfLabels,
} from '@/modules/invoices/services/invoice-pdf';

/**
 * مصدر مستند مالي ذي بنود لا يمثل فاتورة بيع ضريبية: عرض سعر، إشعار، أو مرتجع.
 * يبقي الشكل المتجهي المشترك، ويمنع تمرير QR أو مفاهيم البيع بالخطأ.
 */
export interface LineDocumentPdfLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}

export interface LineDocumentPdfSource {
  number: string;
  date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  lines: LineDocumentPdfLine[];
}

export interface LineDocumentPdfInput {
  document: LineDocumentPdfSource;
  company: SourceCompany | null;
  party: SourceCustomer | null;
  logoUrl?: string | null;
  documentMeta: Array<[string, string | null | undefined]>;
  adjustments?: InvoicePdfAdjustment[];
  labels: InvoicePdfLabels;
  locale: string;
}

/**
 * يرسم المستند نصياً داخل PDF؛ لا يلتقط DOM ولا يضمّن رمز QR.
 * تعمل حقول التاريخ ووصف المستند عبر documentMeta بدلاً من مفاهيم الدفع البيعي.
 */
export async function createLineDocumentPdf(input: LineDocumentPdfInput): Promise<Blob> {
  return createInvoicePdf({
    invoice: {
      number: input.document.number,
      invoice_date: input.document.date,
      // قيمة محايدة للمحرّك؛ حقول بطاقة المستند تصل كاملةً من documentMeta.
      payment_type: 'credit',
      subtotal: input.document.subtotal,
      tax_amount: input.document.tax_amount,
      total: input.document.total,
      lines: input.document.lines.map((line) => ({ ...line, tax_rate: 0 })),
    },
    company: input.company,
    customer: input.party,
    logoUrl: input.logoUrl,
    documentMeta: input.documentMeta,
    adjustments: input.adjustments,
    labels: input.labels,
    locale: input.locale,
  });
}

export const downloadLineDocumentPdf = downloadInvoicePdf;
export const shareLineDocumentPdf = shareInvoicePdf;
