'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/formatting';
import { formatMinorRiyal } from '@/lib/money';
import { listHistory, PricesError } from './client';
import type { HistoryRow, PriceScope } from './contract';

export interface HistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: PriceScope;
  scopeLabel: string;
  timeZone: string | null;
  productName: string;
  fuelProductId: string;
}

type State = { status: 'loading' } | { status: 'error'; error: PricesError } | { status: 'ready'; rows: HistoryRow[]; page: number; last: number; more: boolean; moreError: boolean };

/** سجل أسعار منتج ضمن نطاق: الأحدث أولاً، ترقيم بزر «المزيد»، وبلا أي صفر مُختلَق. للقراءة فقط. */
export function HistorySheet({ open, onOpenChange, scope, scopeLabel, timeZone, productName, fuelProductId }: HistorySheetProps) {
  const t = useTranslations('fuelPrices');
  const locale = useLocale();
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const scopeId = scope.kind === 'station' ? scope.stationId : 'tenant';

  const load = useCallback(async (page: number, previous: HistoryRow[]) => {
    const mine = ++generation.current;
    try {
      const result = await listHistory(scope, fuelProductId, page);
      if (generation.current !== mine) return; // نطاق/منتج تغيّر أو أُغلقت الورقة: رد متأخر لا يُعرض
      const last = result.meta?.last_page ?? page;
      setState({ status: 'ready', rows: [...previous, ...result.data], page, last, more: false, moreError: false });
    } catch (error) {
      if (generation.current !== mine) return;
      const err = error instanceof PricesError ? error : new PricesError('offline');
      if (previous.length > 0) setState((held) => (held.status === 'ready' ? { ...held, more: false, moreError: true } : held));
      else setState({ status: 'error', error: err });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, fuelProductId]);

  useEffect(() => {
    if (!open) { generation.current += 1; return; }
    setState({ status: 'loading' });
    void load(1, []);
  }, [open, load]);

  const sourceLabel = (row: HistoryRow) => (row.entry_source === 'product_card' ? t('history.fromCard') : t('history.manual'));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('close')} className="pb-[env(safe-area-inset-bottom)]">
        <div className="border-b border-border px-5 pb-4 pt-5 pe-14">
          <SheetTitle className="text-lg font-semibold text-text">{t('history.title', { product: productName })}</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted">{scopeLabel}</SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.status === 'loading' ? (
            <div role="status" aria-label={t('loading')} className="space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-border/60" />)}
            </div>
          ) : state.status === 'error' ? (
            <div role="alert" className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted">
              <p className="font-medium text-text">{t(`state.${state.error.kind === 'forbidden' ? 'forbidden' : state.error.kind === 'offline' || state.error.kind === 'timeout' ? 'offline' : 'error'}.title`)}</p>
              <button type="button" onClick={() => { setState({ status: 'loading' }); void load(1, []); }} className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-border px-4 font-medium text-text">{t('retry')}</button>
            </div>
          ) : state.rows.length === 0 ? (
            <p role="status" className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('history.empty')}</p>
          ) : (
            <>
              <ul className="space-y-2.5">
                {state.rows.map((row) => (
                  <li key={row.id} className="rounded-xl border border-border px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-lg font-semibold text-text">
                        <span className="num">{formatMinorRiyal(row.price_per_liter_minor)}</span> <span className="text-xs font-normal text-muted">{t('card.perLiter')}</span>
                      </p>
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${row.status === 'active' ? 'bg-primary-soft text-primary' : 'border border-border text-muted'}`}>
                        {row.status === 'active' ? t('history.statusActive') : t('history.statusInactive')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {t('history.from')}: <span dir="ltr" className="inline-block">{formatDateTime(row.effective_from, locale, { timeZone: timeZone ?? undefined })}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {t('history.to')}: {row.effective_until ? <span dir="ltr" className="inline-block">{formatDateTime(row.effective_until, locale, { timeZone: timeZone ?? undefined })}</span> : t('history.open')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{sourceLabel(row)}</p>
                  </li>
                ))}
              </ul>
              {state.moreError ? <p role="alert" className="mt-3 text-center text-xs text-warning">{t('history.moreError')}</p> : null}
              {state.page < state.last ? (
                <button type="button" disabled={state.more} onClick={() => { setState({ ...state, more: true, moreError: false }); void load(state.page + 1, state.rows); }} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                  {t('history.loadMore')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
