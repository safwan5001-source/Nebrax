'use client';

/** سجل التدقيق للقراءة فقط (`GET …/events`): انتقالات المراجعة (الفاعل · السبب · الوقت). لا إجراء دورة حياة هنا. */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/nebrax';
import { describeError } from '../errors';
import type { PageMeta } from '../contract';
import { fetchEvents } from './client';
import type { ReconciliationEvent } from './types';

const KNOWN_ACTIONS = ['mark_reviewed', 'reopen', 'close', 'void', 'supersede'];

export function EventsTimeline({ reconciliationId, refreshKey }: { reconciliationId: string; refreshKey: number }) {
  const t = useTranslations('partnerStatements');
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<ReconciliationEvent[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setEvents(null);
    fetchEvents(reconciliationId, page)
      .then((response) => {
        setEvents(response.data);
        setMeta(response.meta);
      })
      .catch((err: unknown) => setError(describeError(err).key));
  }, [reconciliationId, page]);

  useEffect(load, [load, refreshKey]);

  if (error) return <ErrorState message={t(`errors.${error}`)} onRetry={load} retryLabel={t('retry')} />;
  if (events === null) return <LoadingState />;
  if (events.length === 0) return <EmptyState titleAs="h2" title={t('workspace.events.empty')} />;

  return (
    <div className="space-y-3" data-testid="events-timeline">
      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded-md border border-border bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">{t(`workspace.events.action_${KNOWN_ACTIONS.includes(event.action) ? event.action : 'other'}`)}</span>
              <span className="num text-xs text-muted" dir="ltr">{(event.created_at ?? '').slice(0, 16).replace('T', ' ')}</span>
            </div>
            {event.from_status && event.to_status ? (
              <p className="text-xs text-muted">{t(`status.${event.from_status}`)} → {t(`status.${event.to_status}`)}</p>
            ) : null}
            {event.reason ? <p className="mt-1 break-words text-muted" dir="auto">{event.reason}</p> : null}
          </li>
        ))}
      </ol>
      {meta ? <Pagination page={meta.current_page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} perPageOptions={[25]} onPageChange={setPage} onPerPageChange={() => {}} /> : null}
    </div>
  );
}
