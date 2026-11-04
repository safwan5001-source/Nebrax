'use client';

import { useTranslations } from 'next-intl';
import type { PriceResult } from './prices';
import { formatPricePerLiter } from './format';
import type { QueryState } from './use-scoped-query';

/**
 * سعر اللتر المعتمد من أَوْج. الغياب أو التعذّر **لا يُعرضان صفراً أبداً**:
 * كل حالة لها نص يميّزها (غير مضبوط / غير متاح لصلاحياتك / ناقص / تعذّر).
 */
export function PriceLabel({ allowed, state, productId }: { allowed: boolean; state: QueryState<Record<string, PriceResult>>; productId: string }) {
  const t = useTranslations('stationOps');
  if (!allowed) return <span className="text-sm text-muted">{t('price.noPermission')}</span>;
  if (state.status === 'loading') return <span className="inline-block h-5 w-24 animate-pulse rounded bg-border/60" aria-label={t('loading')} />;
  if (state.status === 'error') return <span className="text-sm text-warning">{t('price.error')}</span>;

  const result = state.data[productId];
  if (!result) return <span className="text-sm text-muted">{t('price.error')}</span>;

  switch (result.kind) {
    case 'known':
      return (
        <span className="flex flex-col items-end leading-tight">
          <span className="text-lg font-semibold text-text">
            <span className="num">{formatPricePerLiter(result.minor)}</span>
            <span className="ms-1 text-xs font-normal text-muted">{t('price.perLiter')}</span>
          </span>
          {result.scope === 'tenant' ? <span className="text-xs text-muted">{t('price.tenantDefault')}</span> : null}
        </span>
      );
    case 'not_configured':
      return <span className="text-sm font-medium text-warning">{t('price.notConfigured')}</span>;
    case 'incomplete':
      return <span className="text-sm text-warning">{t('price.incomplete')}</span>;
    case 'forbidden':
      return <span className="text-sm text-muted">{t('price.noPermission')}</span>;
    default:
      return <span className="text-sm text-warning">{t('price.error')}</span>;
  }
}
