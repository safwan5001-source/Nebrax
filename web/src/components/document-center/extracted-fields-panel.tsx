'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  confidencePercentage,
  confidenceTone,
  documentFieldTranslationKey,
} from '@/lib/document-review';
import { formatReviewValue } from '@/lib/document-review-format';
import type { ReviewField } from '@/modules/document-center/contract';

type Props = {
  fields: ReviewField[];
  canEdit: boolean;
  onEdit: (field: ReviewField) => void;
};

export function ExtractedFieldsPanel({ fields, canEdit, onEdit }: Props) {
  const t = useTranslations('documentCenterReview');

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('data')}</h2>
          <span className="text-xs text-muted">{t('evidence')}</span>
        </div>
        {fields.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noFields')}</p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {fields.map((field) => {
              const confidence = confidencePercentage(field.confidence_basis_points);
              const label = t(documentFieldTranslationKey(field.key));
              const changed = field.original !== field.current;

              return (
                <div key={field.key} className="rounded border border-border p-3">
                  <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                    {label}
                    {confidence !== null && (
                      <Badge tone={confidenceTone(field.confidence_basis_points)} className="text-xs">
                        {t('score', { score: confidence })}
                      </Badge>
                    )}
                    {changed && <Badge tone="warning" className="text-xs">{t('edited')}</Badge>}
                  </dt>
                  <dd className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-xs text-muted">{t('originalValue')}</span>
                      <p className="mt-1 break-words font-mono text-text">{formatReviewValue(field.key, field.original)}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted">{t('reviewedValue')}</span>
                      <p className="mt-1 break-words font-mono text-text">{formatReviewValue(field.key, field.current)}</p>
                    </div>
                  </dd>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted">
                      {field.page ? t('page', { page: field.page }) : '—'}
                    </span>
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => onEdit(field)}>
                        {t('edit')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
