'use client';

import type { ThemeId } from '@/modules/documents/types';
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
  showLogo = true,
  rootId,
}: {
  quote: QuoteDoc;
  company: QuoteCompany | null;
  customer: QuoteCustomer | null;
  templateId?: string | null;
  themeId?: ThemeId | null;
  footerText?: string | null;
  showLogo?: boolean;
  rootId?: string | null;
}) {
  const model = buildQuoteDocumentModel({ quote, company, customer, footerText });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} rootId={rootId} />
  );
}
