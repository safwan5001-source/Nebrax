'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import { buildQuoteDocumentModel, type SourceQuote } from '@/modules/documents/builder/from-quote';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';

export type QuoteDoc = SourceQuote;
export type QuoteCompany = SourceCompany;
export type QuoteCustomer = SourceCustomer;

/** مستند عرض السعر — غلاف رفيع فوق `DocumentView` (النوع quotation). */
export function QuoteDocument({
  quote,
  company,
  customer,
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
  quote: QuoteDoc;
  company: QuoteCompany | null;
  customer: QuoteCustomer | null;
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
  const model = buildQuoteDocumentModel({ quote, company, customer, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout} rootId={rootId} />
  );
}
