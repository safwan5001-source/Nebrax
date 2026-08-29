'use client';

import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reviewHasVisibleBlocker } from '@/lib/document-review';
import { formatReviewValue } from '@/lib/document-review-format';
import type { DocumentReviewPayload } from '@/modules/document-center/contract';

type Props = {
  open: boolean;
  onClose: () => void;
  review: DocumentReviewPayload;
  onConfirm: () => void;
};

export function DraftPreviewDialog({ open, onClose, review, onConfirm }: Props) {
  const t = useTranslations('documentCenterReview');
  const hasBlocker = reviewHasVisibleBlocker(review.matches, review.issues);
  const totalField = review.fields.find((field) => field.key === 'total_amount_minor' || field.key === 'total_minor');
  const supplierField = review.fields.find((field) => ['supplier_name', 'issuer_name'].includes(field.key));

  return (
    <Dialog open={open} onClose={onClose} title={t('draftPreviewTitle')}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">{t('draftPreviewHint')}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">{t('documentType')}</dt>
            <dd className="mt-1 text-text">{review.batch.document_type}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('lineItems')}</dt>
            <dd className="mt-1 font-mono text-text">{review.lines.length}</dd>
          </div>
          {supplierField && (
            <div>
              <dt className="text-xs text-muted">{t('fieldSupplierName')}</dt>
              <dd className="mt-1 text-text">{formatReviewValue(supplierField.key, supplierField.current)}</dd>
            </div>
          )}
          {totalField && (
            <div>
              <dt className="text-xs text-muted">{t('fieldTotalMinor')}</dt>
              <dd className="mt-1 font-mono text-text">{formatReviewValue(totalField.key, totalField.current)}</dd>
            </div>
          )}
        </dl>

        <div>
          <p className="text-xs font-medium text-text">{t('files')}</p>
          <ul className="mt-2 space-y-1">
            {review.files.map((file) => (
              <li key={file.id} className="truncate font-mono text-xs text-muted">{file.original_name}</li>
            ))}
          </ul>
        </div>

        {(review.warnings.length > 0 || review.issues.length > 0) && (
          <div className="space-y-2">
            {review.warnings.length > 0 && (
              <Badge tone="warning">{review.warnings.length} {t('extractionWarnings')}</Badge>
            )}
            {review.issues.filter((i) => i.severity === 'blocking' && ['open', 'reopened'].includes(i.status)).length > 0 && (
              <Badge tone="negative">{t('readinessBlocked')}</Badge>
            )}
          </div>
        )}

        {hasBlocker && (
          <p role="alert" className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
            {t('draftPreviewBlocked')}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={hasBlocker} onClick={() => { onConfirm(); onClose(); }}>
            {review.batch.document_type === 'expense' ? t('createExpenseDraft') : t('createPurchaseDraft')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
