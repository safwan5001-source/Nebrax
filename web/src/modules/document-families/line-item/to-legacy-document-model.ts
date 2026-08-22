import type { DocumentModel } from '@/modules/documents/types';
import type { LineItemDocument } from '../types';

/**
 * حد توافق مؤقت مع `DocumentView` الحالي. لا يعيد حساب الضريبة أو الإجمالي؛ ينقل
 * القيم المشتقة من مصدر الفاتورة كما استلمها عقد عائلة البنود.
 */
export function lineItemDocumentToLegacyModel(document: LineItemDocument): DocumentModel {
  return {
    type: document.type,
    currency: document.currency,
    direction: document.direction,
    seller: { ...document.seller },
    buyer: { ...document.counterparty },
    meta: { ...document.meta },
    lines: document.lines.map((line) => ({ ...line })),
    totals: { ...document.totals },
    qr: document.compliance.qr ? { ...document.compliance.qr } : null,
    footerText: document.content.footerText,
    notes: document.content.notes,
    terms: document.content.terms,
    bank: document.content.bank,
    stampUrl: document.content.stampUrl,
    signatureUrl: document.content.signatureUrl,
    voucher: null,
  };
}
