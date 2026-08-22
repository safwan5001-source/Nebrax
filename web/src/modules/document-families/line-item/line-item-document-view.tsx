'use client';

import { DocumentView } from '@/modules/documents/components/document-view';
import type { DocSectionLayoutItem, ThemeId } from '@/modules/documents/types';
import type { LineItemDocument } from '../types';
import { lineItemDocumentToLegacyModel } from './to-legacy-document-model';

/**
 * نقطة العرض الجديدة لعائلة البنود. يظل تحويل `DocumentModel` داخل حد التوافق
 * إلى أن ينتقل `DocumentView` إلى عارضات عائلية كاملة.
 */
export function LineItemDocumentView({
  document,
  templateId,
  themeId,
  showLogo = true,
  layout,
  rootId,
}: {
  document: LineItemDocument;
  templateId?: string | null;
  themeId?: ThemeId | null;
  showLogo?: boolean;
  layout?: DocSectionLayoutItem[] | null;
  rootId?: string | null;
}) {
  return (
    <DocumentView
      model={lineItemDocumentToLegacyModel(document)}
      templateId={templateId}
      themeId={themeId}
      showLogo={showLogo}
      layout={layout}
      rootId={rootId}
    />
  );
}
