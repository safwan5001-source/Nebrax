import type {
  DocumentLine,
  DocumentModel,
  DocumentParty,
  DocumentSeller,
  DocumentTotals,
  DocumentVoucher,
} from '@/modules/documents/types';
import {
  isLineItemDocumentType,
  isVoucherDocumentType,
  type DocumentPresentationContent,
  type LineItemDocument,
  type OperationalDocumentPresentation,
  type OperationalPrintableDocument,
  type VoucherDocument,
} from './types';

function cloneParty(party: DocumentParty): DocumentParty {
  return { ...party };
}

function cloneSeller(seller: DocumentSeller): DocumentSeller {
  return { ...seller };
}

function cloneLines(lines: DocumentLine[]): DocumentLine[] {
  return lines.map((line) => ({ ...line }));
}

function cloneTotals(totals: DocumentTotals): DocumentTotals {
  return { ...totals };
}

function cloneVoucher(voucher: DocumentVoucher): DocumentVoucher {
  return {
    ...voucher,
    allocations: voucher.allocations?.map((allocation) => ({ ...allocation })),
  };
}

function presentationFromLegacy(model: DocumentModel): OperationalDocumentPresentation {
  const content: DocumentPresentationContent = {
    footerText: model.footerText ?? null,
    notes: model.notes ?? null,
    terms: model.terms ?? null,
    bank: model.bank ?? null,
    stampUrl: model.stampUrl ?? null,
    signatureUrl: model.signatureUrl ?? null,
  };

  return {
    currency: model.currency,
    direction: model.direction,
    seller: cloneSeller(model.seller),
    counterparty: cloneParty(model.buyer),
    meta: { ...model.meta },
    content,
  };
}

/**
 * جسر مرحلي فقط: يترك `DocumentModel` والمكونات القائمة دون تغيير، لكنه يمنح
 * العارض الجديد عقداً ضيقاً وصريحاً حسب العائلة. لا ينفذ حساباً ولا يحول العملة.
 */
export function adaptLegacyOperationalDocument(model: DocumentModel): OperationalPrintableDocument {
  const presentation = presentationFromLegacy(model);

  if (isLineItemDocumentType(model.type)) {
    const document: LineItemDocument = {
      family: 'line_item',
      type: model.type,
      ...presentation,
      lines: cloneLines(model.lines),
      totals: cloneTotals(model.totals),
      compliance: { qr: model.qr ? { ...model.qr } : null },
    };

    return document;
  }

  if (isVoucherDocumentType(model.type)) {
    if (!model.voucher) {
      throw new Error(`legacy_voucher_payload_missing:${model.type}`);
    }

    const document: VoucherDocument = {
      family: 'voucher',
      type: model.type,
      ...presentation,
      voucher: cloneVoucher(model.voucher),
    };

    return document;
  }

  throw new Error(`legacy_document_family_not_supported:${model.type}`);
}
