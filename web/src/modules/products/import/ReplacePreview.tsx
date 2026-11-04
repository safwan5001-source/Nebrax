'use client';

import type { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ImportPreview } from './contract';

type Media = NonNullable<ImportPreview['media']>;

/**
 * معاينة «استبدال الصور الموجودة»: عدد المنتجات المتأثرة وما سيُضاف ويُزال ويبقى، وتفاصيل القديم مقابل الجديد لكل منتج،
 * ثم **التأكيد الصريح** (جزء من الخيارات المربوطة بالمعاينة: تبديله يُعيد المعاينة من الخادم فيُنفَّذ ما عُوين حرفياً).
 */
export function ReplacePreview({
  media,
  confirmed,
  busy,
  onConfirmChange,
  t,
}: {
  media: Media;
  confirmed: boolean;
  busy: boolean;
  onConfirmChange: (value: boolean) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const affected = media.affected_products ?? 0;
  const toAdd = media.images_to_add ?? 0;
  const toRemove = media.images_to_remove ?? 0;
  const needsConfirmation = media.needs_approval_rows > 0 || (confirmed && toRemove > 0);

  const kpis: Array<[string, number, string]> = [
    ['products', affected, 'text-text'],
    ['add', toAdd, 'text-text'],
    ['remove', toRemove, toRemove > 0 ? 'text-warning' : 'text-muted'],
    ['keep', media.images_kept ?? 0, 'text-muted'],
    ['unchanged', media.unchanged_rows ?? 0, 'text-muted'],
    ['errors', media.error_rows, media.error_rows > 0 ? 'text-negative' : 'text-muted'],
  ];

  return (
    <div className="space-y-4" data-testid="replace-preview">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(([key, value, tone]) => (
          <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
            <dt className="text-xs text-muted">{t(`import_replace_kpi_${key}` as 'import_replace_kpi_products')}</dt>
            <dd className={cn('num mt-0.5 text-lg font-semibold', tone)}>{value}</dd>
          </div>
        ))}
      </dl>

      {media.unmatched_archive.length > 0 ? (
        <p className="text-xs text-warning">{t('import_images_unmatched', { count: media.unmatched_archive.length })}</p>
      ) : null}
      {media.missing_rows.length > 0 ? (
        <p className="text-xs text-muted">{t('import_images_missing', { count: media.missing_rows.length })}</p>
      ) : null}

      {media.rows.length > 0 ? (
        <div className="max-h-96 space-y-2 overflow-y-auto" aria-label={t('import_images_matches')}>
          {media.rows.slice(0, 50).map((row) => (
            <div key={row.row} className="rounded border border-border px-2.5 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num font-medium text-text">{t('import_row')} {row.row}</span>
                <Badge tone={row.status === 'ready' ? 'positive' : row.status === 'error' ? 'negative' : row.status === 'unchanged' ? 'muted' : 'warning'}>
                  {row.status}
                </Badge>
                <span className="text-muted" dir="ltr">{row.sku || '—'}</span>
              </div>
              {row.replacement ? (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-text">{t('import_replace_old', { count: row.replacement.existing_count })}</p>
                    <p className="mt-0.5 break-all text-muted" dir="ltr">
                      {row.replacement.existing_names.length > 0 ? row.replacement.existing_names.join(' · ') : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-text">{t('import_replace_new', { count: row.replacement.new_count })}</p>
                    <p className="mt-0.5 break-all text-muted" dir="ltr">
                      {row.sources.map((source) => `${source.role === 'primary' ? '★ ' : ''}${source.name}`).join(' · ')}
                    </p>
                  </div>
                </div>
              ) : null}
              {row.messages.length > 0 ? (
                <p className={cn('mt-1', row.status === 'error' ? 'text-negative' : 'text-muted')}>{row.messages.join(' · ')}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {affected === 0 && media.error_rows === 0 ? (
        <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted">{t('import_replace_nothing')}</p>
      ) : null}

      {toRemove > 0 || media.needs_approval_rows > 0 ? (
        <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy || media.error_rows > 0}
            onChange={(event) => onConfirmChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>{t('import_replace_confirm', { products: affected, add: toAdd, remove: toRemove })}</span>
        </label>
      ) : null}

      {needsConfirmation && !confirmed ? (
        <p role="alert" className="flex items-center gap-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('import_replace_confirm_required')}
        </p>
      ) : null}
    </div>
  );
}
