'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import { buildPaymentDocumentModel, type SourcePayment } from '@/modules/documents/builder/from-payment';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';
import type { OutputProfile } from '@/modules/print-templates/services/output-profile';

export type PaymentDoc = SourcePayment;
export type PaymentCompany = SourceCompany;
export type PaymentPartner = SourceCustomer;

/** تخطيط ثابت للسند: لا بنود/إجماليات — جسم السند بدل جدول البنود. */
const VOUCHER_LAYOUT: DocSectionLayoutItem[] = [
  { key: 'header', visible: true },
  { key: 'parties', visible: true },
  { key: 'voucher', visible: true },
  { key: 'amountWords', visible: true },
  { key: 'notes', visible: true },
  { key: 'signature', visible: true },
  { key: 'stamp', visible: true },
  { key: 'footer', visible: true },
];

/** مستند سند القبض/الصرف — غلاف رفيع فوق `DocumentView` بتخطيط سند ثابت. */
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
  layout,
  outputProfile,
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
  /** تخطيط صريح (جذر PDF الملتقَط بتخطيط مراجعة PDF)؛ غيابه = تخطيط السند الثابت للمعاينة والطباعة كما كان. */
  layout?: DocSectionLayoutItem[] | null;
  /** ملف الإخراج من المراجعة المطبَّقة (AWJ-DOC-V2-PR4)؛ غيابه = السلوك السابق. */
  outputProfile?: OutputProfile | null;
  rootId?: string | null;
}) {
  const model = buildPaymentDocumentModel({ payment, company, partner, footerText, logoUrl, logoHeight, bank, stampUrl, signatureUrl });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout && layout.length ? layout : VOUCHER_LAYOUT} rootId={rootId} outputProfile={outputProfile} />
  );
}
