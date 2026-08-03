'use client';

import type { ThemeId } from '@/modules/documents/types';
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
  showLogo = true,
  logoUrl,
  logoHeight,
  rootId,
}: {
  note: CreditNoteDoc;
  company: CreditNoteCompany | null;
  customer: CreditNoteCustomer | null;
  templateId?: string | null;
  themeId?: ThemeId | null;
  footerText?: string | null;
  showLogo?: boolean;
  logoUrl?: string | null;
  logoHeight?: number | null;
  rootId?: string | null;
}) {
  const model = buildCreditNoteDocumentModel({ note, company, customer, footerText, logoUrl, logoHeight });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} rootId={rootId} />
  );
}
