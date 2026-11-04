'use client';

/** «دفاترنا غير الموجودة في الكشف» (`missing_in_statement`): قائمة **معلوماتية** لا تمنع المراجعة ولا يُتخذ بشأنها قرار. جهة الدفتر لا تحمل `decision`. */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/nebrax';
import { describeError } from '../errors';
import type { PageMeta } from '../contract';
import { unitKind } from './candidate-picker';
import { fetchMatches } from './client';
import { Money } from './presentation';
import type { MatchRow } from './types';

export function LedgerOnlyList({ reconciliationId, runId, refreshKey }: { reconciliationId: string; runId: string | null; refreshKey: number }) {
  const t = useTranslations('partnerStatements');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!runId) return;
    setError(null);
    fetchMatches(reconciliationId, { runId, side: 'ledger', outcomes: ['missing_in_statement'], page, perPage: 25 })
      .then((response) => {
        setRows(response.data);
        setMeta(response.meta);
      })
      .catch((err: unknown) => setError(describeError(err).key));
  }, [reconciliationId, runId, page]);

  useEffect(load, [load, refreshKey]);

  if (!runId) return <EmptyState titleAs="h2" title={t('workspace.ledger.no_run')} />;
  if (error) return <ErrorState message={t(`errors.${error}`)} onRetry={load} retryLabel={t('retry')} />;
  if (rows === null) return <LoadingState />;

  return (
    <div className="space-y-3" data-testid="ledger-only">
      <p className="text-sm leading-relaxed text-muted">{t('workspace.ledger.intro')}</p>
      {rows.length === 0 ? (
        <EmptyState titleAs="h2" title={t('workspace.ledger.empty')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-text" dir="auto">{row.unit?.doc_number ?? row.unit_key ?? '—'}</span>
                <span className="block text-xs text-muted">
                  {row.unit?.kind ? t(`workspace.unit_kind.${unitKind(row.unit.kind)}`) : ''} · <span className="num" dir="ltr">{row.unit?.date ?? '—'}</span>
                  {row.unit?.direction ? ` · ${t(`workspace.direction.${row.unit.direction === 'debit' ? 'debit' : 'credit'}`)}` : ''}
                </span>
              </span>
              <Money minor={row.unit?.amount_minor ?? null} />
            </li>
          ))}
        </ul>
      )}
      {meta ? <Pagination page={meta.current_page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} perPageOptions={[25]} onPageChange={setPage} onPerPageChange={() => {}} /> : null}
    </div>
  );
}
