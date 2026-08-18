'use client';

import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { DocumentView } from '@/modules/documents/components/document-view';
import {
  buildPurchaseOrderDocumentModel,
  type SourcePurchaseOrder,
  type SourcePurchaseOrderCompany,
  type SourcePurchaseOrderSupplier,
} from '@/modules/documents/builder/from-purchase-order';

export type PurchaseOrderDoc = SourcePurchaseOrder;
export type PurchaseOrderCompany = SourcePurchaseOrderCompany;
export type PurchaseOrderSupplier = SourcePurchaseOrderSupplier;

/** أمر الشراء الصادر — غلاف رفيع فوق `DocumentView` (النوع purchase_order). */
export function PurchaseOrderDocument({
  order,
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
  order: PurchaseOrderDoc;
  company: PurchaseOrderCompany | null;
  supplier: PurchaseOrderSupplier | null;
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
  const model = buildPurchaseOrderDocumentModel({
    order, company, supplier, footerText, logoUrl, logoHeight,
    terms, bank, stampUrl, signatureUrl,
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
