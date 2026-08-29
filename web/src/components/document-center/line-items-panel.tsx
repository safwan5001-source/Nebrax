'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  confidencePercentage,
  confidenceTone,
  lineFieldTranslationKey,
} from '@/lib/document-review';
import { formatReviewValue } from '@/lib/document-review-format';
import type { ReviewLine, ReviewLineField } from '@/modules/document-center/contract';

type EditTarget = {
  targetKey: string;
  fieldLabel: string;
  value: string | number | boolean | null;
};

type Props = {
  lines: ReviewLine[];
  canEdit: boolean;
  onEdit: (target: EditTarget) => void;
};

export function LineItemsPanel({ lines, canEdit, onEdit }: Props) {
  const t = useTranslations('documentCenterReview');

  if (lines.length === 0) {
    return (
      <Card>
        <CardContent className="py-5">
          <h2 className="font-semibold text-text">{t('lineItems')}</h2>
          <p className="mt-4 text-sm text-muted">{t('noLineItems')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-5">
        <h2 className="font-semibold text-text">{t('lineItems')}</h2>
        <p className="mt-1 text-xs text-muted">{t('lineItemsHint')}</p>

        <div className="mt-4 hidden overflow-hidden rounded border border-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 text-start">#</th>
                <th className="px-3 py-2 text-start">{t('lineDescription')}</th>
                <th className="px-3 py-2 text-start">{t('lineSku')}</th>
                <th className="px-3 py-2 text-start">{t('lineQuantity')}</th>
                <th className="px-3 py-2 text-start">{t('lineUnitPrice')}</th>
                <th className="px-3 py-2 text-start">{t('lineTotal')}</th>
                <th className="px-3 py-2 text-end">{t('edit')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow key={line.index} line={line} canEdit={canEdit} onEdit={onEdit} t={t} variant="table" />
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 md:hidden">
          {lines.map((line) => (
            <LineRow key={line.index} line={line} canEdit={canEdit} onEdit={onEdit} t={t} variant="card" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function fieldMap(line: ReviewLine): Map<string, ReviewLineField> {
  return new Map(line.fields.map((field) => [field.key, field]));
}

function LineRow({
  line,
  canEdit,
  onEdit,
  t,
  variant,
}: {
  line: ReviewLine;
  canEdit: boolean;
  onEdit: (target: EditTarget) => void;
  t: ReturnType<typeof useTranslations<'documentCenterReview'>>;
  variant: 'table' | 'card';
}) {
  const fields = fieldMap(line);
  const quantity = fields.get('quantity');
  const unitPrice = fields.get('unit_price_minor');
  const total = fields.get('total_minor');
  const sku = fields.get('sku');
  const confidence = confidencePercentage(line.confidence_basis_points);

  function editField(field: ReviewLineField | undefined) {
    if (!field?.editable || !canEdit) return;
    onEdit({
      targetKey: `lines.${line.index}.${field.key}`,
      fieldLabel: t(lineFieldTranslationKey(field.key)),
      value: field.current,
    });
  }

  if (variant === 'table') {
    return (
      <tr className="border-t border-border">
        <td className="px-3 py-2 font-mono text-xs">{line.index + 1}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span>{line.description ?? '—'}</span>
            {confidence !== null && <Badge tone={confidenceTone(line.confidence_basis_points)} className="text-xs">{t('score', { score: confidence })}</Badge>}
          </div>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{formatReviewValue('sku', sku?.current ?? null)}</td>
        <td className="px-3 py-2 font-mono text-xs">{formatReviewValue('quantity', quantity?.current ?? null)}</td>
        <td className="px-3 py-2 font-mono text-xs">{formatReviewValue('unit_price_minor', unitPrice?.current ?? null)}</td>
        <td className="px-3 py-2 font-mono text-xs">{formatReviewValue('total_minor', total?.current ?? null)}</td>
        <td className="px-3 py-2 text-end">
          {canEdit && (
            <div className="flex justify-end gap-1">
              {line.fields.filter((field) => field.editable).map((field) => (
                <Button key={field.key} size="sm" variant="outline" onClick={() => editField(field)}>
                  {t(lineFieldTranslationKey(field.key))}
                </Button>
              ))}
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <article className="rounded border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-text">
            <span className="font-mono text-xs text-muted">#{line.index + 1}</span>
            {' '}{line.description ?? '—'}
          </p>
          {sku && <p className="mt-1 font-mono text-xs text-muted">{formatReviewValue('sku', sku.current)}</p>}
        </div>
        {confidence !== null && <Badge tone={confidenceTone(line.confidence_basis_points)}>{t('score', { score: confidence })}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {line.fields.map((field) => (
          <div key={field.key}>
            <dt className="text-muted">{t(lineFieldTranslationKey(field.key))}</dt>
            <dd className="mt-0.5 font-mono text-text">{formatReviewValue(field.key, field.current)}</dd>
          </div>
        ))}
      </dl>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {line.fields.filter((f) => f.editable).map((field) => (
            <Button key={field.key} size="sm" variant="outline" onClick={() => editField(field)}>
              {t('edit')} {t(lineFieldTranslationKey(field.key))}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
