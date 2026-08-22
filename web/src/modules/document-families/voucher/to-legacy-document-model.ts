import type { DocumentModel } from '@/modules/documents/types';
import type { VoucherDocument } from '../types';

/**
 * حد توافق مؤقت مع `DocumentView` القائم. حقول `lines` و`totals` مطلوبة من
 * العارض القديم فقط؛ لا تظهر في `VoucherDocument` ولا تعود إلى صفحة السند.
 */
export function voucherDocumentToLegacyModel(document: VoucherDocument): DocumentModel {
  return {
    type: document.type,
    currency: document.currency,
    direction: document.direction,
    seller: { ...document.seller },
    buyer: { ...document.counterparty },
    meta: { ...document.meta },
    lines: [],
    totals: {
      subtotal: document.voucher.amount,
      tax: 0,
      total: document.voucher.amount,
    },
    qr: null,
    footerText: document.content.footerText,
    notes: document.content.notes,
    terms: document.content.terms,
    bank: document.content.bank,
    stampUrl: document.content.stampUrl,
    signatureUrl: document.content.signatureUrl,
    voucher: {
      ...document.voucher,
      allocations: document.voucher.allocations?.map((allocation) => ({ ...allocation })),
    },
  };
}
