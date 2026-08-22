import type {
  CurrencyCode,
  Direction,
  DocumentLine,
  DocumentMeta,
  DocumentParty,
  DocumentQr,
  DocumentSeller,
  DocumentTotals,
  DocumentTypeId,
  DocumentVoucher,
} from '@/modules/documents/types';

/**
 * العائلات ليست مسمياتٍ للواجهة فقط؛ هي حدود عقدية تمنع تمرير فاتورة إلى عارض سند
 * أو تقرير إلى قالب بنود. لا تحسب هذه الطبقة مالاً ولا تملك دورة مصدر تشغيلي.
 */
export type PrintableFamily = 'line_item' | 'voucher' | 'account_statement' | 'tabular_report';

export const LINE_ITEM_DOCUMENT_TYPES = [
  'tax_invoice',
  'simplified_tax_invoice',
  'quotation',
  'proforma_invoice',
  'sales_order',
  'purchase_order',
  'purchase_invoice',
  'delivery_note',
  'packing_list',
  'credit_note',
  'debit_note',
] as const satisfies readonly DocumentTypeId[];

export type LineItemDocumentType = (typeof LINE_ITEM_DOCUMENT_TYPES)[number];

export const VOUCHER_DOCUMENT_TYPES = [
  'receipt_voucher',
  'payment_voucher',
] as const satisfies readonly DocumentTypeId[];

export type VoucherDocumentType = (typeof VOUCHER_DOCUMENT_TYPES)[number];

export function isLineItemDocumentType(type: DocumentTypeId): type is LineItemDocumentType {
  return (LINE_ITEM_DOCUMENT_TYPES as readonly DocumentTypeId[]).includes(type);
}

export function isVoucherDocumentType(type: DocumentTypeId): type is VoucherDocumentType {
  return (VOUCHER_DOCUMENT_TYPES as readonly DocumentTypeId[]).includes(type);
}

/** خصائص عرض ثابتة أو مختارة من مراجعة تصميم؛ لا تعيد طبقة العرض تفسير مصدر المال. */
export interface DocumentPresentationContent {
  footerText: string | null;
  notes: string | null;
  terms: string | null;
  bank: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
}

/** قاسم عرض مشترك فقط؛ لا يحتوي بنوداً أو أرصدة أو أعمدة تقرير. */
export interface OperationalDocumentPresentation {
  currency: CurrencyCode;
  direction: Direction;
  seller: DocumentSeller;
  counterparty: DocumentParty;
  meta: DocumentMeta;
  content: DocumentPresentationContent;
}

/** فاتورة أو مستند تشغيلي له بنود ومجاميع مشتقة من المصدر. */
export interface LineItemDocument extends OperationalDocumentPresentation {
  family: 'line_item';
  type: LineItemDocumentType;
  lines: readonly DocumentLine[];
  totals: DocumentTotals;
  compliance: {
    qr: DocumentQr | null;
  };
}

/** سند قبض أو صرف؛ عمداً لا يحمل بنود منتجات أو إجماليات فاتورة. */
export interface VoucherDocument extends OperationalDocumentPresentation {
  family: 'voucher';
  type: VoucherDocumentType;
  voucher: DocumentVoucher;
}

/**
 * كشف حساب طرف مشتق من محرك التقرير/الأستاذ. المبالغ تأتي كسلاسل من API كي لا
 * تتحول bigint الخلفية إلى Number غير آمن في المتصفح أو PDF.
 */
export interface AccountStatementEntry {
  date: string;
  journalEntryId: string;
  journalNumber: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceNumber: string | null;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface AccountStatementDocument {
  family: 'account_statement';
  organization: DocumentSeller;
  subject: DocumentParty;
  scope: {
    from: string | null;
    to: string | null;
    branchIds: readonly string[];
    currency: CurrencyCode;
  };
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  entries: readonly AccountStatementEntry[];
  generatedAt: string;
}

export type TabularReportCell =
  | { kind: 'text'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'count'; value: number }
  | { kind: 'money'; value: string; currency: CurrencyCode }
  | { kind: 'document_link'; label: string; documentType: string; documentId: string; documentNumber: string | null };

export interface TabularReportColumn {
  id: string;
  labelKey: string;
  valueKind: TabularReportCell['kind'];
  alignment: 'start' | 'center' | 'end';
}

export interface TabularReportRow {
  id: string;
  cells: Readonly<Record<string, TabularReportCell>>;
}

export interface TabularReportGroup {
  id: string;
  label: string;
  context: Readonly<Record<string, TabularReportCell>>;
  rows: readonly TabularReportRow[];
  subtotal: Readonly<Record<string, TabularReportCell>> | null;
}

/** تقرير تحليلي أو محاسبي؛ لا يملك حالة إصدار ولا يولد قيداً. */
export interface TabularReportDocument {
  family: 'tabular_report';
  reportKey: string;
  titleKey: string;
  organization: DocumentSeller;
  scope: Readonly<Record<string, string | readonly string[] | null>>;
  columns: readonly TabularReportColumn[];
  groups: readonly TabularReportGroup[];
  grandTotal: Readonly<Record<string, TabularReportCell>> | null;
  generatedAt: string;
}

export type PrintableDocument =
  | LineItemDocument
  | VoucherDocument
  | AccountStatementDocument
  | TabularReportDocument;

export type OperationalPrintableDocument = LineItemDocument | VoucherDocument;
