'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, CheckCheck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { PageHeader, Pagination, type PageAction } from '@/components/nebrax';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import {
  type AppNotification,
  type NotificationCategory,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
} from '@/lib/notifications';

type TabValue = 'all' | NotificationCategory;
type ReadFilter = 'all' | 'read' | 'unread';

interface NotificationsMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

const severityTone = (severity: AppNotification['severity']) =>
  severity === 'critical' ? 'negative' : severity === 'warning' ? 'warning' : 'muted';

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, error: toastError } = useToast();

  const [tab, setTab] = useState<TabValue>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [meta, setMeta] = useState<NotificationsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetchNotifications({
        category: tab === 'all' ? undefined : tab,
        read: readFilter === 'all' ? undefined : readFilter,
        page,
        per_page: perPage,
      });
      setItems(res.data);
      setMeta(res.meta ?? null);
    } catch (err) {
      setLoadFailed(true);
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tab, readFilter, page, perPage, t, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  async function markOne(notification: AppNotification) {
    if (notification.read_at) return;
    try {
      const updated = await markNotificationRead(notification.id);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      success(t('markAllSuccess'));
      await load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setMarkingAll(false);
    }
  }

  const tabs: TabDef[] = [
    { id: 'all', label: t('tabs.all') },
    { id: 'alert', label: t('tabs.alerts') },
    { id: 'update', label: t('tabs.updates') },
  ];

  const readOptions: { value: ReadFilter; label: string }[] = [
    { value: 'all', label: t('readFilter.all') },
    { value: 'unread', label: t('readFilter.unread') },
    { value: 'read', label: t('readFilter.read') },
  ];

  const columns: ColumnDef<AppNotification, unknown>[] = [
    {
      accessorKey: 'title',
      header: t('titleColumn'),
      cell: ({ row }) => (
        <div className="min-w-56 space-y-1">
          <p className={row.original.read_at ? 'text-text' : 'font-semibold text-text'}>{row.original.title}</p>
          <p className="line-clamp-2 text-sm text-muted">{row.original.message}</p>
        </div>
      ),
    },
    {
      accessorKey: 'category',
      header: t('category'),
      cell: ({ row }) => (
        <span className="text-sm text-muted">
          {t(row.original.category === 'alert' ? 'tabs.alerts' : 'tabs.updates')}
        </span>
      ),
    },
    {
      accessorKey: 'severity',
      header: t('severityColumn'),
      cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{t(`severity.${row.original.severity}`)}</Badge>,
    },
    {
      accessorKey: 'created_at',
      header: t('date'),
      cell: ({ row }) => <span className="num text-sm text-muted">{formatDateTime(row.original.created_at, locale)}</span>,
    },
    {
      id: 'status',
      header: t('statusColumn'),
      cell: ({ row }) => (row.original.read_at ? <Badge tone="muted">{t('read')}</Badge> : <Badge tone="neutral">{t('unread')}</Badge>),
    },
    {
      id: 'source',
      header: t('source'),
      cell: ({ row }) => {
        const href = notificationHref(row.original);
        return href ? (
          <Link href={href} onClick={() => markOne(row.original)} className="text-sm font-medium text-primary hover:underline">
            {t('viewSource')}
          </Link>
        ) : (
          <span className="text-sm text-muted">{t('noSource')}</span>
        );
      },
    },
    {
      id: 'actions',
      header: t('actions'),
      cell: ({ row }) =>
        !row.original.read_at ? (
          <Button size="sm" variant="outline" onClick={() => markOne(row.original)}>
            <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
            {t('markRead')}
          </Button>
        ) : null,
    },
  ];

  const headerActions: PageAction[] = [
    {
      key: 'mark-all',
      label: markingAll ? t('markingAll') : t('markAllRead'),
      icon: CheckCheck,
      onClick: markAll,
      variant: 'outline',
      disabled: markingAll,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('pageTitle')} description={t('pageSubtitle')} actions={headerActions} />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(value) => {
          setTab(value as TabValue);
          setPage(1);
        }}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('readFilter.label')}>
        {readOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setReadFilter(option.value);
              setPage(1);
            }}
            aria-pressed={readFilter === option.value}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              readFilter === option.value
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border text-muted hover:text-text'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loadFailed && !loading ? (
        <div className="rounded border border-negative/30 bg-negative/10 p-4">
          <p className="text-sm text-text">{t('loadFailed')}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          emptyLabel={t('empty')}
          exportName="notifications"
          showToolbar={false}
          mobileRecord={(item) => ({
            title: item.title,
            subtitle: item.message,
            badge: <Badge tone={severityTone(item.severity)}>{t(`severity.${item.severity}`)}</Badge>,
            status: item.read_at ? <Badge tone="muted">{t('read')}</Badge> : <Badge tone="neutral">{t('unread')}</Badge>,
            meta: formatDateTime(item.created_at, locale),
            actions: !item.read_at ? (
              <Button size="sm" variant="outline" onClick={() => markOne(item)}>
                <Check className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t('markRead')}
              </Button>
            ) : undefined,
          })}
        />
      )}

      {meta && (
        <Pagination
          page={meta.current_page}
          lastPage={meta.last_page}
          perPage={meta.per_page}
          total={meta.total}
          disabled={loading}
          onPageChange={setPage}
          onPerPageChange={(next) => {
            setPerPage(next);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
