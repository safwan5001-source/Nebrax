'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import {
  buildInvoiceDocumentModel,
  type SourceInvoice,
  type SourceCompany,
  type SourceCustomer,
} from '@/modules/documents/builder/from-invoice';

// توافق رجعي: تبقى الأنواع مُصدَّرة بأسمائها لمن يستوردها (شاشة تفاصيل الفاتورة).
export type InvoiceDoc = SourceInvoice;
export type Company = SourceCompany;
export type Customer = SourceCustomer;

/**
 * مستند الفاتورة الضريبية — غلاف رفيع فوق العارض العامّ `DocumentView`:
 * يبني `DocumentModel` من الفاتورة ويعرض القالب المسجَّل. مصدر واحد للشاشة/الطباعة/الـ PDF.
 */
export function InvoiceDocument({
  invoice,
  company,
  customer,
  qr,
  templateId,
  themeId,
  footerText,
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
  showLogo?: boolean;
  logoUrl?: string | null;
  logoHeight?: number | null;
  layout?: DocSectionLayoutItem[] | null;
  rootId?: string | null;
}) {
  const model = buildInvoiceDocumentModel({ invoice, company, customer, qr, footerText, logoUrl, logoHeight });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout} rootId={rootId} />
  );
}
