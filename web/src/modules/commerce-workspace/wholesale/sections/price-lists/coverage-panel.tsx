'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/nebrax';
import { StatCard } from '../../components/stat-card';
import { COVERAGE_MAX_PAGES, collectPublishedProducts, computeCoverage, type Coverage } from './api';
import { priceListsMessages } from './messages';

const PAGE = 10;

type Run = { status: 'idle' } | { status: 'running' } | { status: 'failed' } | { status: 'done'; coverage: Coverage; partial: boolean; scanned: number; serverTotal: number };

/**
 * Real-data coverage of one price list over the products published on the active store. Runs on demand, scans at most
 * COVERAGE_MAX_PAGES server pages and says so when it stopped early — a partial scan is never shown as a total.
 */
export function CoveragePanel({ storeId, itemProductIds }: { storeId: string; itemProductIds: string[] }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [page, setPage] = useState(1);

  async function start() {
    setRun({ status: 'running' });
    setPage(1);
    try {
      const { products, partial, serverTotal } = await collectPublishedProducts(storeId);
      setRun({ status: 'done', coverage: computeCoverage(products, itemProductIds), partial, scanned: products.length, serverTotal });
    } catch {
      setRun({ status: 'failed' });
    }
  }

  const done = run.status === 'done' ? run : null;
  const pages = done ? Math.max(1, Math.ceil(done.coverage.uncovered.length / PAGE)) : 1;
  const percent = done && done.coverage.total > 0 ? Math.round((done.coverage.covered / done.coverage.total) * 100) : null;

  return (
    <section aria-label={t('coverageTitle')} className="space-y-3 rounded border border-border p-3">
      <div>
        <h3 className="text-sm font-medium text-text">{t('coverageTitle')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t('coverageIntro')}</p>
      </div>
      <Button type="button" variant="outline" className="min-h-11" disabled={run.status === 'running'} onClick={() => void start()}>
        {run.status === 'running' ? t('coverageRunning') : t('coverageRun')}
      </Button>
      {run.status === 'failed' ? <FormAlert tone="error">{t('coverageFailed')}</FormAlert> : null}
      {done ? (
        <div className="space-y-3" aria-live="polite">
          {done.partial ? (
            <FormAlert tone="warning">{t('coveragePartial', { scanned: done.scanned, total: done.serverTotal, pages: COVERAGE_MAX_PAGES })}</FormAlert>
          ) : null}
          {done.coverage.total === 0 ? (
            <p className="text-sm text-muted">{t('coverageNoPublished')}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label={t('coverageTotal')} value={done.coverage.total} />
                <StatCard label={t('coverageCovered')} value={done.coverage.covered} />
                <StatCard label={t('coverageUncovered')} value={done.coverage.uncovered.length} />
                <StatCard label={t('coveragePercent')} value={percent === null ? '—' : `${percent}%`} />
              </div>
              {done.coverage.itemsOutsideCatalog > 0 ? (
                <p className="text-xs text-muted">
                  {t('coverageOutside')}: <span className="num">{done.coverage.itemsOutsideCatalog}</span>
                </p>
              ) : null}
              {done.coverage.uncovered.length === 0 ? (
                <p className="text-sm text-positive">{t('coverageAllCovered')}</p>
              ) : (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-muted">{t('coverageUncoveredList')}</h4>
                  <ul className="divide-y divide-border rounded border border-border">
                    {done.coverage.uncovered.slice((page - 1) * PAGE, page * PAGE).map((product) => (
                      <li key={product.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                        <bdi className="min-w-0 truncate">{product.name}</bdi>
                        {product.sku ? <span className="num shrink-0 text-xs text-muted">{product.sku}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {pages > 1 ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                        {t('prev')}
                      </Button>
                      <span className="num text-xs text-muted">{t('coveragePage', { page, pages })}</span>
                      <Button type="button" variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
                        {t('next')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
