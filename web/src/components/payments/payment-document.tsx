'use client';

import type { ThemeId } from '@/modules/documents/types';
import { buildVoucherDocument } from '@/modules/document-families/voucher/from-payment';
import { VoucherDocumentView } from '@/modules/document-families/voucher/voucher-document-view';
import type { SourcePayment } from '@/modules/documents/builder/from-payment';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';

export type PaymentDoc = SourcePayment;
export type PaymentCompany = SourceCompany;
export type PaymentPartner = SourceCustomer;

/** مستند سند القبض/الصرف — غلاف رفيع فوق عارض عائلة السند. */
export function PaymentDocument({
  payment,
  company,
  partner,
  templateId,
  themeId,
  footerText,
  bank,
  stampUrl,
  signatureUrl,
  showLogo = true,
  logoUrl,
  logoHeight,
  rootId,
}: {
  payment: PaymentDoc;
  company: PaymentCompany | null;
  partner: PaymentPartner | null;
  templateId?: string | null;
  themeId?: ThemeId | null;
  footerText?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
  showLogo?: boolean;
  logoUrl?: string | null;
  logoHeight?: number | null;
  rootId?: string | null;
}) {
  const document = buildVoucherDocument({ payment, company, partner, footerText, logoUrl, logoHeight, bank, stampUrl, signatureUrl });
  return <VoucherDocumentView document={document} templateId={templateId} themeId={themeId} showLogo={showLogo} rootId={rootId} />;
}
