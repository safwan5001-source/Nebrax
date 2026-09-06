'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Bell, CheckCheck, Circle, Info, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Dropdown } from '../ui/dropdown';
import { Tabs, TabPanel, type TabDef } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/nebrax';
import { formatDateTime } from '@/lib/formatting';
import {
  type AppNotification,
  type NotificationCategory,
  fetchNotifications,
  fetchUnreadCount,
  formatUnreadBadge,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
} from '@/lib/notifications';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 60_000;
const PANEL_PAGE_SIZE = 10;

type TabValue = 'all' | NotificationCategory;
type PanelStatus = 'idle' | 'loading' | 'error' | 'ready';

const SEVERITY_ICON: Record<AppNotification['severity'], LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const SEVERITY_TONE: Record<AppNotification['severity'], 'muted' | 'warning' | 'negative'> = {
  info: 'muted',
  warning: 'warning',
  critical: 'negative',
};

/**
 * جرس الإشعارات في القشرة — يضيف عنصراً واحداً للشريط العلوي بلا إعادة تصميمه
 * (نفس نمط قوائم الإنشاء السريع والحساب المنسدلة أصلاً). العدّاد يُحدَّث دورياً
 * ومحتوى اللوحة يُحمَّل كسولاً عند الفتح فقط.
 *
 * انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.2.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const [unreadCount, setUnreadCount] = useState(0);
  const [tab, setTab] = useState<TabValue>('all');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [status, setStatus] = useState<PanelStatus>('idle');
  const tabRef = useRef<TabValue>('all');
  tabRef.current = tab;

  const refreshUnreadCount = useCallback(() => {
    fetchUnreadCount().then(setUnreadCount).catch(() => {
      // فشل صامت: العدّاد يبقى بآخر قيمة معروفة، والمحاولة التالية دورية.
    });
  }, []);

  useEffect(() => {
    refreshUnreadCount();
    const timer = window.setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUnreadCount]);

  const loadPanel = useCallback((value: TabValue) => {
    setStatus('loading');
    fetchNotifications({ category: value === 'all' ? undefined : value, per_page: PANEL_PAGE_SIZE })
      .then((res) => {
        setItems(res.data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  function handleOpenChange(open: boolean) {
    if (!open) return;
    refreshUnreadCount();
    loadPanel(tabRef.current);
  }

  function changeTab(next: string) {
    const value = next as TabValue;
    setTab(value);
    loadPanel(value);
  }

  async function handleMarkOne(notification: AppNotification) {
    if (notification.read_at) return;
    try {
      const updated = await markNotificationRead(notification.id);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      refreshUnreadCount();
    } catch {
      // فشل صامت: الصف يبقى غير مقروء، وإعادة المحاولة متاحة بنقرة أخرى.
    }
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? now })));
      refreshUnreadCount();
    } catch {
      // فشل صامت: التحديث الدوري التالي للعدّاد يعكس الحالة الفعلية من الخادم.
    }
  }

  const tabs: TabDef[] = [
    { id: 'all', label: t('tabs.all') },
    { id: 'alert', label: t('tabs.alerts') },
    { id: 'update', label: t('tabs.updates') },
  ];

  return (
    <Dropdown
      align="end"
      mobilePopover
      onOpenChange={handleOpenChange}
      menuLabel={t('panelLabel')}
      triggerLabel={unreadCount > 0 ? t('bellLabelUnread', { count: unreadCount }) : t('bellLabel')}
      triggerClassName="relative h-11 w-11 justify-center text-text hover:bg-primary-soft hover:text-primary"
      menuClassName="w-[22rem] max-w-[calc(100vw-1.5rem)] p-0"
      trigger={
        <>
          <Bell className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              data-testid="notification-badge"
              aria-hidden="true"
              className="num absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-none text-white"
            >
              {formatUnreadBadge(unreadCount)}
            </span>
          )}
        </>
      }
    >
      {({ close }) => (
        <div className="flex max-h-[28rem] flex-col">
          <Tabs tabs={tabs} value={tab} onChange={changeTab} className="px-1" />
          <div className="flex-1 overflow-y-auto">
            <TabPanel id={tab}>
              {status === 'loading' && <LoadingState variant="cards" rows={3} surface="bare" className="p-3" />}
              {status === 'error' && (
                <ErrorState surface="bare" message={t('loadFailed')} onRetry={() => loadPanel(tab)} />
              )}
              {status === 'ready' && items.length === 0 && <EmptyState surface="bare" title={t('empty')} />}
              {status === 'ready' && items.length > 0 && (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <NotificationRow
                      key={item.id}
                      notification={item}
                      locale={locale}
                      onMarkRead={handleMarkOne}
                      onNavigate={close}
                      viewSourceLabel={t('viewSource')}
                      severityLabel={(severity) => t(`severity.${severity}`)}
                    />
                  ))}
                </ul>
              )}
            </TabPanel>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('markAllRead')}
            </button>
            <Link
              href="/notifications"
              onClick={close}
              className="rounded px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
            >
              {t('viewAll')}
            </Link>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function NotificationRow({
  notification,
  locale,
  onMarkRead,
  onNavigate,
  viewSourceLabel,
  severityLabel,
}: {
  notification: AppNotification;
  locale: string;
  onMarkRead: (notification: AppNotification) => void;
  onNavigate: () => void;
  viewSourceLabel: string;
  severityLabel: (severity: AppNotification['severity']) => string;
}) {
  const Icon = SEVERITY_ICON[notification.severity];
  const isRead = notification.read_at !== null;
  const href = notificationHref(notification);

  return (
    <li
      className={cn('flex gap-2.5 px-3 py-2.5', !isRead && 'bg-primary-soft/40')}
      onClick={() => onMarkRead(notification)}
    >
      <span className="mt-0.5 shrink-0">
        <Icon
          className={cn(
            'h-4 w-4',
            notification.severity === 'critical' && 'text-negative',
            notification.severity === 'warning' && 'text-warning',
            notification.severity === 'info' && 'text-muted'
          )}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm leading-snug', isRead ? 'text-text' : 'font-semibold text-text')}>
            {notification.title}
          </p>
          {!isRead && (
            <Circle className="mt-1 h-2 w-2 shrink-0 fill-primary text-primary" aria-hidden="true" />
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted">{notification.message}</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[notification.severity]}>{severityLabel(notification.severity)}</Badge>
            <span className="num text-[11px] text-muted">{formatDateTime(notification.created_at, locale)}</span>
          </div>
          {href && (
            <Link
              href={href}
              onClick={onNavigate}
              className="text-xs font-medium text-primary hover:underline"
            >
              {viewSourceLabel}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
