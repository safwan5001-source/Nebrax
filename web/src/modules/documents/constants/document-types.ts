import type { DocumentTypeId } from '../types';

/** ترتيب أنواع المستندات. مفاتيح الترجمة تحت namespace: `documentTypes`. */
export const DOCUMENT_TYPES: DocumentTypeId[] = [
  'tax_invoice',
  'simplified_tax_invoice',
  'quotation',
  'proforma_invoice',
  'sales_order',
  'purchase_order',
  'delivery_note',
  'packing_list',
  'receipt_voucher',
  'payment_voucher',
  'credit_note',
  'debit_note',
  'statement_of_account',
];
