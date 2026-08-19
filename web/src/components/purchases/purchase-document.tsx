'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import {
  buildPurchaseDocumentModel,
  type SourcePurchase,
} from '@/modules/documents/builder/from-purchase';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';

export type PurchaseDoc = SourcePurchase;
export type PurchaseCompany = SourceCompany;
export type PurchaseSupplier = SourceCustomer;

/** فاتورة المشتريات عبر العارض الموحّد؛ تستخدم للشاشة أو جذر الإخراج الحراري المثبت. */
export function PurchaseDocument({
  purchase,
  company,
  supplier,
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
  purchase: PurchaseDoc;
  company: PurchaseCompany | null;
  supplier: PurchaseSupplier | null;
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
  const model = buildPurchaseDocumentModel({
    purchase,
    company,
    supplier,
    footerText,
    logoUrl,
    logoHeight,
    terms,
    bank,
    stampUrl,
    signatureUrl,
  });

  return (
    <DocumentView
      model={model}
      templateId={templateId}
      themeId={themeId}
      showLogo={showLogo}
      layout={layout}
      rootId={rootId}
    />
  );
}
