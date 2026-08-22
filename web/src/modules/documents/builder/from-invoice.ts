import { buildInvoiceLineItemDocument } from '@/modules/document-families/line-item/from-invoice';
import { lineItemDocumentToLegacyModel } from '@/modules/document-families/line-item/to-legacy-document-model';
import type { DocumentModel } from '../types';

/**
 * أشكال المصدر (عقد الـ API للفاتورة) — المبالغ بالريال نصّاً كما يعيدها الـ backend.
 * تبقى مصدّرة هنا لتوافق شاشات الفاتورة والبناة القائمة.
 */
export interface SourceInvoiceLine {
  id: string;
  product_name?: string | null;
  product_code?: string | null;
  barcode?: string | null;
  description: string | null;
  quantity: number;
  unit_price: string;
  unit_price_before_tax?: string | null;
  tax_rate: number;
  line_tax: string;
  line_total: string;
}

export interface SourceInvoice {
  number: string;
  invoice_date: string;
  payment_type: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes?: string | null;
  lines: SourceInvoiceLine[];
}

export interface SourceCompany {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
  /** شعار هوية المنشأة كما يعيده /me؛ يُستخدم عند غياب شعار مخصص لتصميم الفاتورة. */
  logo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  building_no?: string | null;
  street?: string | null;
  additional_no?: string | null;
  district?: string | null;
  city?: string | null;
  postal_code?: string | null;
  short_address?: string | null;
}

export interface SourceCustomer {
  name: string;
  vat_number?: string | null;
  city?: string | null;
}

/**
 * جسر توافق للعارضات القائمة. يبني المصدر الآن `LineItemDocument` أولاً، ثم يمرر
 * القيم المشتقة نفسها إلى `DocumentView` القديم إلى أن تنتقل كل عارضات البنود.
 */
export function buildInvoiceDocumentModel(input: {
  invoice: SourceInvoice;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
  qr: string | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  return lineItemDocumentToLegacyModel(buildInvoiceLineItemDocument(input));
}
