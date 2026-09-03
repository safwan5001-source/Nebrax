'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Clock, Loader, RefreshCw, XCircle, type LucideIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  DELIVERY_STATUSES, WEBHOOK_EVENTS, listDeliveries,
  type DeliveryStatus, type DeveloperDelivery, type DeveloperWebhook,
} from '@/lib/developer';
import { formatDateTime, formatShortDate } from '@/lib/formatting';

const STATUS_META: Record<DeliveryStatus, { icon: LucideIcon; tone: 'positive' | 'negative' | 'warning' | 'muted' }> = {
  delivered: { icon: CheckCircle2, tone: 'positive' },
  failed: { icon: XCircle, tone: 'negative' },
  retry_scheduled: { icon: RefreshCw, tone: 'warning' },
  processing: { icon: Loader, tone: 'muted' },
  pending: { icon: Clock, tone: 'muted' },
};

/** حالة التسليم — أيقونة + نصّ (لا لون وحده §19). */
function StatusBadge({ status }: { status: DeliveryStatus }) {
  const t = useTranslations('developer.deliveries.status');
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

export function DeliveriesPanel({ endpoints }: { endpoints: DeveloperWebhook[] }) {
  const t = useTranslations('developer.deliveries');
  const locale = useLocale();
  const [rows, setRows] = useState<DeveloperDelivery[] | null>(null);
  const [meta, setMeta] = useState<{ current_page: number; last_page: number; per_page: number; total: number }>({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [eventType, setEventType] = useState('');
  const [endpointId, setEndpointId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // منسّق مركزي (لا Intl مباشر — حارس صيغة التاريخ).
  const when = useCallback((iso: string | null, withTime = true) => (
    iso ? (withTime ? formatDateTime(iso, locale, { dateStyle: 'short', timeStyle: 'short' }) : formatShortDate(iso, locale)) : '—'
  ), [locale]);

  const load = useCallback(async () => {
    setError(false);
    setRows(null);
    try {
      const result = await listDeliveries({
        status: status || undefined,
        event_type: eventType || undefined,
        webhook_endpoint_id: endpointId || undefined,
        page,
        per_page: perPage,
      });
      setRows(result.data);
      setMeta(result.meta);
    } catch {
      setError(true);
    }
  }, [status, eventType, endpointId, page, perPage]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo<ColumnDef<DeveloperDelivery, unknown>[]>(() => [
    { id: 'event', enableSorting: false, header: t('colEvent'), cell: ({ row }) => <code dir="ltr" className="font-mono text-xs text-text">{row.original.event_type ?? '—'}</code> },
    { id: 'endpoint', enableSorting: false, header: t('colEndpoint'), cell: ({ row }) => <span dir="ltr" className="block max-w-[240px] truncate font-mono text-xs text-muted">{row.original.endpoint_url ?? '—'}</span> },
    { id: 'status', enableSorting: false, header: t('colStatus'), cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'http', enableSorting: false, header: t('colHttp'), cell: ({ row }) => <span className="num text-sm">{row.original.http_status ?? '—'}</span> },
    { id: 'attempts', enableSorting: false, header: t('colAttempts'), cell: ({ row }) => <span className="num text-sm">{row.original.attempts}</span> },
    { id: 'created', enableSorting: false, header: t('colLastAttempt'), cell: ({ row }) => <span className="num text-xs text-muted">{when(row.original.created_at)}</span> },
    { id: 'next', enableSorting: false, header: t('colNextRetry'), cell: ({ row }) => <span className="num text-xs text-muted">{when(row.original.next_attempt_at)}</span> },
  ], [t, when]);

  const mobileRecord = useCallback((row: DeveloperDelivery) => ({
    title: <code dir="ltr" className="font-mono text-xs">{row.event_type ?? '—'}</code>,
    subtitle: <span dir="ltr" className="font-mono text-xs">{row.endpoint_url ?? '—'}</span>,
    status: <StatusBadge status={row.status} />,
    secondary: { label: t('colHttp'), value: row.http_status ?? '—' },
    meta: when(row.created_at),
  }), [t, when]);

  const resetPageAnd = <T,>(setter: (v: T) => void) => (value: T) => { setter(value); setPage(1); };

  return (
    <div className="space-y-3">
      {/* المرشّحات */}
      <div className="flex flex-wrap gap-2">
        <Select aria-label={t('filterStatus')} value={status} onChange={(e) => resetPageAnd(setStatus)(e.target.value as DeliveryStatus | '')} className="w-auto">
          <option value="">{t('filterStatus')}: {t('filterAll')}</option>
          {DELIVERY_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </Select>
        <Select aria-label={t('filterEvent')} value={eventType} onChange={(e) => resetPageAnd(setEventType)(e.target.value)} className="w-auto">
          <option value="">{t('filterEvent')}: {t('filterAll')}</option>
          {WEBHOOK_EVENTS.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        {endpoints.length > 0 ? (
          <Select aria-label={t('filterEndpoint')} value={endpointId} onChange={(e) => resetPageAnd(setEndpointId)(e.target.value)} className="w-auto max-w-[220px]">
            <option value="">{t('filterEndpoint')}: {t('filterAll')}</option>
            {endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.url}</option>)}
          </Select>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={rows ?? []}
        loading={rows === null && !error}
        error={error ? t('loadError') : null}
        onRetry={() => void load()}
        showToolbar={false}
        emptyLabel={t('empty')}
        emptyDescription={t('emptyHint')}
        mobileRecord={mobileRecord}
      />

      {rows && meta.total > 0 ? (
        <Pagination
          page={meta.current_page}
          lastPage={meta.last_page}
          perPage={meta.per_page}
          total={meta.total}
          onPageChange={setPage}
          onPerPageChange={(value) => { setPerPage(value); setPage(1); }}
        />
      ) : null}
    </div>
  );
}
