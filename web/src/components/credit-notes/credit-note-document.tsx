'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import { buildCreditNoteDocumentModel, type SourceCreditNote } from '@/modules/documents/builder/from-credit-note';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';

export type CreditNoteDoc = SourceCreditNote;
export type CreditNoteCompany = SourceCompany;
export type CreditNoteCustomer = SourceCustomer;

/** مستند الإشعار الدائن — غلاف رفيع فوق `DocumentView` (النوع credit_note). */
export function CreditNoteDocument({
  note,
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
  note: CreditNoteDoc;
  company: CreditNoteCompany | null;
  customer: CreditNoteCustomer | null;
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
  const model = buildCreditNoteDocumentModel({ note, company, customer, footerText, logoUrl, logoHeight, terms, bank, stampUrl, signatureUrl });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout} rootId={rootId} />
  );
}
