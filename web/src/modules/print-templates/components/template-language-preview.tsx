'use client';

import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import type { DocSectionLayoutItem, DocumentModel, ThemeId } from '@/modules/documents/types';
import { applyDocumentLanguageToPreview } from '../document-language-preview';
import type { DocumentLanguageMode } from '../document-language';
import { DocumentLanguageSelector } from './document-language-selector';

export function TemplateLanguagePreview({
  model,
  languageMode,
  templateId,
  themeId,
  showLogo,
  layout,
  readOnly = false,
  onLanguageChange,
}: {
  model: DocumentModel;
  languageMode: DocumentLanguageMode;
  templateId: string;
  themeId: ThemeId;
  showLogo: boolean;
  layout: DocSectionLayoutItem[];
  readOnly?: boolean;
  onLanguageChange: (mode: DocumentLanguageMode) => void;
}) {
  const preview = applyDocumentLanguageToPreview(model, languageMode);

  return (
    <div className="space-y-4">
      <DocumentLanguageSelector
        value={languageMode}
        disabled={readOnly}
        onChange={onLanguageChange}
      />
      <div className="min-h-[620px] rounded-lg border border-border bg-background p-3">
        <DocumentScaler>
          <DocumentView
            model={preview}
            templateId={templateId}
            themeId={themeId}
            showLogo={showLogo}
            layout={layout}
            rootId="print-template-preview"
          />
        </DocumentScaler>
      </div>
    </div>
  );
}
