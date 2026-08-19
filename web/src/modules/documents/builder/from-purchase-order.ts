import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';

/** أشكال مصدر أمر الشراء (عقد الـ API) — المبالغ بالريال نصّاً. */
export interface SourcePurchaseOrderLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}

export interface SourcePurchaseOrder {
  number: string;
  doc_date: string;
  due_date: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes?: string | null;
  lines: SourcePurchaseOrderLine[];
}

export type SourcePurchaseOrderCompany = SourceCompany;
export type SourcePurchaseOrderSupplier = SourceCustomer;

/**
 * يبني نموذج أمر شراء (نوع `purchase_order`) من السجل التجاري الصادر.
 * لا ينتج هذا التحويل قيداً ولا حركة مخزون؛ ويحوّل مبالغ API النصية إلى هللات
 * فقط عند حدّ العارض الموحد.
 */
export function buildPurchaseOrderDocumentModel(input: {
  order: SourcePurchaseOrder;
  company: SourcePurchaseOrderCompany | null;
  supplier: SourcePurchaseOrderSupplier | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  const {
    order, company, supplier, footerText, logoUrl, logoHeight,
    terms, bank, stampUrl, signatureUrl,
  } = input;

  return {
    type: 'purchase_order',
    currency: 'SAR',
    direction: 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : null,
      logoHeight: logoHeight ?? null,
    },
    buyer: {
      name: supplier?.name ?? '—',
      vatNumber: supplier?.vat_number ?? null,
      city: supplier?.city ?? null,
    },
    meta: {
      number: order.number,
      date: order.doc_date,
      dueDate: order.due_date,
      paymentType: null,
    },
    lines: order.lines.map((line) => ({
      id: line.id,
      description: line.description ?? '',
      quantity: line.quantity,
      unitPrice: riyalToMinor(line.unit_price),
      tax: riyalToMinor(line.line_tax),
      total: riyalToMinor(line.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(order.subtotal),
      tax: riyalToMinor(order.tax_amount),
      total: riyalToMinor(order.total),
    },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: order.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
