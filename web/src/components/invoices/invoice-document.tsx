'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { buildInvoiceLineItemDocument } from '@/modules/document-families/line-item/from-invoice';
import { LineItemDocumentView } from '@/modules/document-families/line-item/line-item-document-view';
import type {
  SourceInvoice,
  SourceCompany,
  SourceCustomer,
} from '@/modules/documents/builder/from-invoice';

// توافق رجعي: تبقى الأنواع مُصدَّرة بأسمائها لمن يستوردها (شاشة تفاصيل الفاتورة).
export type InvoiceDoc = SourceInvoice;
export type Company = SourceCompany;
export type Customer = SourceCustomer;

/**
 * مستند الفاتورة الضريبية — غلاف رفيع فوق عارض عائلة البنود مع الحفاظ على القالب المسجَّل.
 */
export function InvoiceDocument({
  invoice,
  company,
  customer,
  qr,
  templateId,
  themeId,
  footerText,
  terms,
  bank,
  stampUrl,
  signatureUrl,
  showLogo = true,
  logoUrl,
  logoHeight,
  layout,
  rootId,
}: {
  invoice: InvoiceDoc;
  company: Company | null;
  customer: Customer | null;
  qr: string | null;
  templateId?: string | null;
  themeId?: ThemeId | null;
  footerText?: string | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
  showLogo?: boolean;
  logoUrl?: string | null;
  logoHeight?: number | null;
  layout?: DocSectionLayoutItem[] | null;
  rootId?: string | null;
}) {
  const document = buildInvoiceLineItemDocument({ invoice, company, customer, qr, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl });
  return <LineItemDocumentView document={document} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout} rootId={rootId} />;
}
