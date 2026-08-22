'use client';

import { DocumentView } from '@/modules/documents/components/document-view';
import type { DocSectionLayoutItem, ThemeId } from '@/modules/documents/types';
import type { VoucherDocument } from '../types';
import { voucherDocumentToLegacyModel } from './to-legacy-document-model';

/** تخطيط ثابت للسند: لا جدول بنود ولا ملخص فاتورة. */
export const VOUCHER_DOCUMENT_LAYOUT: DocSectionLayoutItem[] = [
  { key: 'header', visible: true },
  { key: 'parties', visible: true },
  { key: 'voucher', visible: true },
  { key: 'amountWords', visible: true },
  { key: 'notes', visible: true },
  { key: 'signature', visible: true },
  { key: 'stamp', visible: true },
  { key: 'footer', visible: true },
];

/**
 * نقطة العرض الجديدة لعائلة السند. يبقى تحويل `DocumentModel` داخل الحد
 * التوافقي إلى أن ينتقل DocumentView نفسه إلى العارضات العائلية.
 */
export function VoucherDocumentView({
  document,
  templateId,
  themeId,
  showLogo = true,
  rootId,
}: {
  document: VoucherDocument;
  templateId?: string | null;
  themeId?: ThemeId | null;
  showLogo?: boolean;
  rootId?: string | null;
}) {
  return (
    <DocumentView
      model={voucherDocumentToLegacyModel(document)}
      templateId={templateId}
      themeId={themeId}
      showLogo={showLogo}
      layout={VOUCHER_DOCUMENT_LAYOUT}
      rootId={rootId}
    />
  );
}
