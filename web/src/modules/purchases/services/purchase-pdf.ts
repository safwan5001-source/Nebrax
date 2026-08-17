import type { Company } from '@/lib/company';
import type { Party, DocAdjustment, DocLine } from '@/components/documents/tax-document';
import type { DocSectionLayoutItem } from '@/modules/documents/types';
import {
  createInvoicePdf,
  downloadInvoicePdf,
  shareInvoicePdf,
  type InvoicePdfLabels,
} from '@/modules/invoices/services/invoice-pdf';

export interface PurchasePdfSource {
  number: string;
  purchase_date: string;
  payment_type: string;
  supplier_invoice_no: string | null;
  due_date: string | null;
  received_status: string | null | undefined;
  received_date: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  lines: DocLine[];
}

export interface PurchasePdfLabels extends InvoicePdfLabels {
  supplierInvoiceNumber: string;
  dueDate: string;
  receiptStatus: string;
  receivedPending: string;
  receivedPartial: string;
  receivedFull: string;
}

export async function createPurchaseInvoicePdf(input: {
  purchase: PurchasePdfSource;
  company: Company | null;
  supplier: Party | null;
  adjustments: DocAdjustment[];
  /** تذييل مراجعة القالب المثبتة عند ترحيل الفاتورة. */
  footerText?: string | null;
  /** تخطيط مراجعة PDF المثبتة، ويشمل خصائص الكتل المتقدمة. */
  templateLayout?: DocSectionLayoutItem[] | null;
  /** محتوى الشروط من مراجعة المخرج المثبتة. */
  termsText?: string | null;
  /** بيانات البنك من مراجعة المخرج المثبتة. */
  bankText?: string | null;
  labels: PurchasePdfLabels;
  locale: string;
}): Promise<Blob> {
  const receivedStatus = input.purchase.received_status === 'received'
    ? 'full'
    : (input.purchase.received_status ?? 'pending');
  const receivedLabel = receivedStatus === 'full'
    ? input.labels.receivedFull
    : receivedStatus === 'partial'
      ? input.labels.receivedPartial
      : input.labels.receivedPending;

  return createInvoicePdf({
    invoice: {
      number: input.purchase.number,
      invoice_date: input.purchase.purchase_date,
      payment_type: input.purchase.payment_type,
      subtotal: input.purchase.subtotal,
      tax_amount: input.purchase.tax_amount,
      total: input.purchase.total,
      lines: input.purchase.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        tax_rate: 0,
        line_tax: line.line_tax,
        line_total: line.line_total,
      })),
    },
    company: input.company,
    customer: input.supplier,
    adjustments: input.adjustments,
    footerText: input.footerText,
    templateLayout: input.templateLayout,
    termsText: input.termsText,
    bankText: input.bankText,
    documentMeta: [
      [input.labels.date, input.purchase.purchase_date],
      [input.labels.paymentType, input.purchase.payment_type === 'cash' ? input.labels.cash : input.labels.credit],
      [input.labels.supplierInvoiceNumber, input.purchase.supplier_invoice_no],
      [input.labels.dueDate, input.purchase.due_date],
      [input.labels.receiptStatus, receivedLabel],
    ],
    labels: input.labels,
    locale: input.locale,
  });
}

export { downloadInvoicePdf as downloadPurchaseInvoicePdf, shareInvoicePdf as sharePurchaseInvoicePdf };
