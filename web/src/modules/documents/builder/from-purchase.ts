import { riyalToMinor } from '@/lib/money';
import type { DocumentModel } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';
import { buildDocumentSeller } from './company-seller';

/** أشكال مصدر فاتورة المشتريات كما يعيدها عقد الـ API، ومبالغها بالريال نصّاً. */
export interface SourcePurchaseLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}

export interface SourcePurchase {
  number: string;
  purchase_date: string;
  due_date?: string | null;
  payment_type: string;
  subtotal: string;
  tax_amount: string;
  discount?: string;
  shipping?: string;
  adjustment?: string;
  total: string;
  notes?: string | null;
  lines: SourcePurchaseLine[];
}

/**
 * يبني نموذج فاتورة مشتريات بالقيم المعروضة في الاستجابة. يبقى نوع المستند
 * `purchase_invoice` لكي تترجم الترويسة والأطراف وفق الشراء، ولا يعاد استخدام
 * عنوان فاتورة مبيعات في الإخراج الحراري.
 */
export function buildPurchaseDocumentModel(input: {
  purchase: SourcePurchase;
  company: SourceCompany | null;
  supplier: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): DocumentModel {
  const {
    purchase,
    company,
    supplier,
    footerText,
    logoUrl,
    logoHeight,
    terms,
    bank,
    stampUrl,
    signatureUrl,
  } = input;
  const seller = buildDocumentSeller(company, { logoUrl, logoHeight });

  return {
    type: 'purchase_invoice',
    currency: 'SAR',
    direction: 'rtl',
    seller,
    buyer: {
      name: supplier?.name ?? '—',
      vatNumber: supplier?.vat_number ?? null,
      city: supplier?.city ?? null,
    },
    meta: {
      number: purchase.number,
      date: purchase.purchase_date,
      dueDate: purchase.due_date ?? null,
      paymentType: purchase.payment_type === 'cash' ? 'cash' : 'credit',
    },
    lines: purchase.lines.map((line) => ({
      id: line.id,
      description: line.description ?? '',
      quantity: line.quantity,
      unitPrice: riyalToMinor(line.unit_price),
      tax: riyalToMinor(line.line_tax),
      total: riyalToMinor(line.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(purchase.subtotal),
      discount: riyalToMinor(purchase.discount ?? '0'),
      shipping: riyalToMinor(purchase.shipping ?? '0'),
      adjustment: riyalToMinor(purchase.adjustment ?? '0'),
      tax: riyalToMinor(purchase.tax_amount),
      total: riyalToMinor(purchase.total),
    },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: purchase.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
