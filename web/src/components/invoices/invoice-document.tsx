'use client';

import { useLocale } from 'next-intl';
import type { Direction, DocumentLanguage, DocumentTypeId, ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
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
  terms,
  bank,
  stampUrl,
  signatureUrl,
  showLogo = true,
  logoUrl,
  logoHeight,
  layout,
  rootId,
  documentType,
  direction,
  language,
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
  documentType?: DocumentTypeId;
  direction?: Direction;
  /**
   * لغة المستند الصريحة — تفوز على `invoice.language_effective` من عقد الـAPI،
   * وتفوز على استنتاج UI locale × direction. لا تُخزَّن على الفاتورة.
   */
  language?: DocumentLanguage | null;
}) {
  const locale = useLocale();
  // اتجاه المستند الأولي: الـprop الصريح ثم اشتقاق من لغة الوثيقة (إن جاءت)،
  // ثم سلوك ما قبل PR-LANG-1 حرفياً (استنتاج من UI locale). أي انسياب يظل داخل
  // `buildInvoiceDocumentModel` كذلك، فهذا مجرد fallback لكل مستدعٍ لا يعرف language.
  const effectiveLanguage = language ?? invoice.language_effective ?? null;
  const resolvedDirection = direction
    ?? (effectiveLanguage === 'en' ? 'ltr' : effectiveLanguage === 'ar' || effectiveLanguage === 'bilingual' ? 'rtl' : (locale === 'en' ? 'ltr' : 'rtl'));
  const model = buildInvoiceDocumentModel({
    invoice,
    company,
    customer,
    qr,
    footerText,
    logoUrl,
    logoHeight,
    terms,
    bank,
    stampUrl,
    signatureUrl,
    type: documentType,
    direction: resolvedDirection,
    language: effectiveLanguage,
  });
  return (
    <DocumentView model={model} templateId={templateId} themeId={themeId} showLogo={showLogo} layout={layout} rootId={rootId} />
  );
}
