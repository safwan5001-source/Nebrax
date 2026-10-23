'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { apiErrorMessage, type GatewayConnection, type GatewayEvent } from './contract';

/** سجل أحداث الاتصال (إداري، ثابت، بلا أسرار): النوع، الانتقال، من فعل، السبب، أسماء الحقول المتغيّرة فقط. */
export function EventsDialog({ connection, onClose }: { connection: GatewayConnection | null; onClose: () => void }) {
  const t = useTranslations('paymentGateways');
  const locale = useLocale();
  const [events, setEvents] = useState<GatewayEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    setEvents(null);
    setError(null);
    api<{ data: GatewayEvent[] }>(`/payment-gateways/${connection.id}/events`)
      .then((response) => !cancelled && setEvents(response.data))
      .catch((err) => !cancelled && setError(apiErrorMessage(err) ?? t('events.failed')));
    return () => {
      cancelled = true;
    };
  }, [connection, t]);

  return (
    <Dialog open={connection !== null} onClose={onClose} title={t('events.title')} className="max-w-xl">
      {error ? (
        <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>
      ) : events === null ? (
        <div className="space-y-2" role="status" aria-busy="true" aria-label={t('events.loading')}>
          {[0, 1, 2].map((n) => <Skeleton key={n} className="h-12 w-full" />)}
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('events.empty')}</p>
      ) : (
        <ol className="space-y-2" data-testid="pg-events">
          {events.map((event) => (
            <li key={event.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-text">{t.has(`events.types.${event.event_type}`) ? t(`events.types.${event.event_type}`) : event.event_type}</span>
                <time className="num text-xs text-muted" dir="ltr">{formatDateTime(event.occurred_at, locale)}</time>
              </div>
              {(event.from_status || event.to_status) && (
                <p className="mt-1 text-xs text-muted">
                  {event.from_status ? t(`status.${event.from_status}`) : '—'} → {event.to_status ? t(`status.${event.to_status}`) : '—'}
                </p>
              )}
              {event.reason && <p className="mt-1 text-xs text-text">{event.reason}</p>}
              {event.changed_fields && event.changed_fields.length > 0 && (
                <p className="mt-1 text-xs text-muted">{t('events.fields')}: <span dir="ltr">{event.changed_fields.join(', ')}</span></p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
