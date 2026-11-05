'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PriceResult } from './prices';
import { formatInZone, formatPricePerLiter } from './format';
import type { QueryState } from './use-scoped-query';

/** أسباب منع البيع التي نملك لها نصاً؛ أي رمز غير معروف لا يُعرض نصاً مخترعاً. */
const KNOWN_BLOCKERS = ['tax_mode_unset', 'unit_mapping_invalid', 'product_inactive', 'price_not_configured'] as const;

/**
 * سعر اللتر المعتمد من أَوْج (السعر الفعّال كما يحسمه الخادم، وهو نفسه ما يُسعَّر به إنهاء البيع).
 * الغياب أو التعذّر **لا يُعرضان صفراً أبداً**: كل حالة لها نص يميّزها (غير مضبوط / غير نشط / غير متاح لصلاحياتك / تعذّر).
 * يعرض مصدر السعر وتاريخ سريانه ونمط الضريبة، وسبب تعذّر البيع الرسمي إن وُجد.
 */
export function PriceLabel({
  allowed,
  state,
  productId,
  timeZone,
}: {
  allowed: boolean;
  state: QueryState<Record<string, PriceResult>>;
  productId: string;
  timeZone?: string | null;
}) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  if (!allowed) return <span className="text-sm text-muted">{t('price.noPermission')}</span>;
  if (state.status === 'loading') return <span className="inline-block h-5 w-24 animate-pulse rounded bg-border/60" aria-label={t('loading')} />;
  if (state.status === 'error') return <span className="text-sm text-warning">{t('price.error')}</span>;

  const result = state.data[productId];
  if (!result) return <span className="text-sm text-muted">{t('price.error')}</span>;

  switch (result.kind) {
    case 'known': {
      const blockers = result.blockers.filter((code): code is (typeof KNOWN_BLOCKERS)[number] => (KNOWN_BLOCKERS as readonly string[]).includes(code));
      return (
        <span className="flex flex-col items-end text-end leading-tight">
          <span className="text-lg font-semibold text-text">
            <span className="num">{formatPricePerLiter(result.minor)}</span>
            <span className="ms-1 text-xs font-normal text-muted">{t('price.perLiter')}</span>
          </span>
          <span className="text-xs text-muted">{result.scope === 'tenant' ? t('price.tenantDefault') : t('price.stationPrice')}</span>
          <span className="text-xs text-muted">
            {result.taxMode === 'tax_inclusive' ? t('price.taxInclusive') : result.taxMode === 'tax_exclusive' ? t('price.taxExclusive') : t('price.taxUnset')}
          </span>
          {result.effectiveFrom ? (
            <span className="text-xs text-muted">
              {t('price.since', { date: formatInZone(result.effectiveFrom, locale, timeZone, 'date') })}
              {result.effectiveUntil ? ` ${t('price.until', { date: formatInZone(result.effectiveUntil, locale, timeZone, 'date') })}` : ''}
            </span>
          ) : null}
          {!result.sellable
            ? blockers.map((code) => (
                <span key={code} className="mt-0.5 text-xs text-warning">{t(`price.blocked.${code}`)}</span>
              ))
            : null}
        </span>
      );
    }
    case 'not_configured':
      return (
        <span className="flex flex-col items-end text-end leading-tight">
          <span className="text-sm font-medium text-warning">{t('price.notConfigured')}</span>
          <span className="text-xs text-muted">{t('price.notConfiguredHint')}</span>
        </span>
      );
    case 'product_inactive':
      return <span className="text-sm text-warning">{t('price.productInactive')}</span>;
    case 'forbidden':
      return <span className="text-sm text-muted">{t('price.noPermission')}</span>;
    default:
      return <span className="text-sm text-warning">{t('price.error')}</span>;
  }
}
