'use client';

import { Eye } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { getRevisionVisualPreview, type RevisionVisualPreviewSource } from '@/modules/print-templates/services/revision-visual-preview';

interface TemplateRevisionVisualComparisonProps {
  before: RevisionVisualPreviewSource;
  after: RevisionVisualPreviewSource;
}

export function TemplateRevisionVisualComparison({ before, after }: TemplateRevisionVisualComparisonProps) {
  const t = useTranslations('printTemplateStudio');
  const beforePreview = useMemo(() => getRevisionVisualPreview(before), [before]);
  const afterPreview = useMemo(() => getRevisionVisualPreview(after), [after]);
  const panes = [
    { revision: before, preview: beforePreview, label: t('revision_before') },
    { revision: after, preview: afterPreview, label: t('revision_after') },
  ];

  return (
    <section className="space-y-3" aria-labelledby="revision-visual-comparison-title">
      <div className="flex items-start gap-2">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h3 id="revision-visual-comparison-title" className="text-sm font-medium text-text">{t('revision_visual_comparison')}</h3>
          <p className="mt-1 text-xs text-muted">{t('revision_visual_comparison_hint')}</p>
        </div>
      </div>
      <div className="grid max-w-full gap-4 lg:grid-cols-2">
        {panes.map(({ revision, preview, label }) => (
          <section key={revision.id} className="min-w-0 overflow-hidden rounded border border-border bg-background" aria-labelledby={`revision-visual-${revision.id}`}>
            <header className="border-b border-border bg-surface px-3 py-2">
              <h4 id={`revision-visual-${revision.id}`} className="text-xs font-medium text-text">
                {label} · {t('revision', { version: revision.version })}
              </h4>
            </header>
            <div className="p-2">
              <DocumentScaler>
                <DocumentView
                  model={preview.model}
                  templateId={preview.templateId}
                  themeId={preview.themeId}
                  showLogo={preview.showLogo}
                  layout={preview.layout}
                  rootId={preview.rootId}
                />
              </DocumentScaler>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
