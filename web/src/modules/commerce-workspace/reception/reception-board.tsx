'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { BellRing, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { ErrorState, FormAlert, LoadingState } from '@/components/nebrax';
import { formatTime } from '@/lib/formatting';
import { alertMessages } from '../alerts/messages';
import { isStale } from '../alerts/alert-engine';
import { useOrderAlerts } from '../alerts/use-order-alerts';
import { useOptionalCommerceStoreContext } from '../store-context';
import { BOARD_COLUMNS, groupOrders, type BoardColumnKey } from './board-columns';
import { receptionMessages } from './messages';
import { OrderCard } from './order-card';
import { useReceptionBoard } from './use-reception-board';

/**
 * مساحة استقبال الطلبات (COPS-H3-5): لوحة أعمدة من حقائق الخادم + تنبيه حي. **لا استطلاع ولا محرّك صوت خاصّان بها**: تقرأ حالة `OrderAlertsProvider` المشتركة
 * (القائد الواحد/الجهاز، حامل الصوت، الإقرار R-10) وتعيد جلب اللوحة عند تغيّر `snapshot.revision` فقط. بوابة التنبيه مغلقة ⇒ إشعار واضح، لا استطلاع،
 * والتحديث يدوي. لا منطق حالة: التصنيف عرضٌ لـ`operational_status` و`alert.pending` القادمين من الخادم.
 */
export function ReceptionBoard() {
  const locale = useLocale();
  const { t } = receptionMessages(locale);
  const alertsText = alertMessages(locale);
  const alerts = useOrderAlerts();
  const storeContext = useOptionalCommerceStoreContext();
  const storefrontId = storeContext?.selectedStoreId ?? null;
  const board = useReceptionBoard({ storefrontId, enabled: true, revision: alerts.snapshot.revision });
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<BoardColumnKey>('new');
  const [acking, setAcking] = useState<ReadonlySet<string>>(new Set());
  const [ackFailed, setAckFailed] = useState<ReadonlySet<string>>(new Set());

  // مؤقّت عرض فقط (عمر الطلب والاتصال) — لا شبكة.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);

    return () => window.clearInterval(timer);
  }, []);

  const pendingIds = useMemo(() => new Set(alerts.snapshot.pending.map((p) => p.orderId)), [alerts.snapshot.pending]);
  const groups = useMemo(() => groupOrders(board.orders, pendingIds), [board.orders, pendingIds]);

  async function onAcknowledge(orderId: string) {
    if (acking.has(orderId)) return;
    setAcking((cur) => new Set(cur).add(orderId));
    setAckFailed((cur) => { const next = new Set(cur); next.delete(orderId); return next; });
    const outcome = await alerts.acknowledge(orderId);
    setAcking((cur) => { const next = new Set(cur); next.delete(orderId); return next; });
    if (!outcome.ok && !outcome.settled) setAckFailed((cur) => new Set(cur).add(orderId));
  }

  const alertsOn = alerts.status === 'on';
  const snapshot = alerts.snapshot;
  const stale = alertsOn && isStale(snapshot, now);
  const connection = stale && snapshot.connection === 'live' ? 'degraded' : snapshot.connection;
  const statusText = !alertsOn
    ? t('statusOff')
    : { idle: t('statusConnecting'), connecting: t('statusConnecting'), live: t('statusLive'), degraded: t('statusDegraded'), offline: t('statusOffline') }[connection];
  const dotClass = !alertsOn ? 'bg-muted' : connection === 'live' ? 'bg-positive' : connection === 'offline' || connection === 'degraded' ? 'bg-negative' : 'bg-muted';
  const soundArmed = alerts.soundState === 'armed';

  return (
    <div data-testid="reception-board" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-2.5">
        <span role="status" data-testid="board-connection" className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-text">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          {statusText}
        </span>

        {alertsOn && (
          <span data-testid="board-pending-count" className="num inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-text">
            <BellRing aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            {t('pendingNow', { count: snapshot.pending.length })}
          </span>
        )}

        {alertsOn && (
          <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted">
            {soundArmed ? <Volume2 aria-hidden="true" className="h-4 w-4" /> : <VolumeX aria-hidden="true" className="h-4 w-4" />}
            {soundArmed ? alertsText.t('soundOn') : alertsText.t('soundOff')}
          </span>
        )}
        {alertsOn && !soundArmed && (
          <button type="button" data-testid="board-sound-enable" onClick={() => void alerts.enableSound()} className="inline-flex min-h-11 items-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {alertsText.t('soundEnable')}
          </button>
        )}

        <div className="ms-auto flex flex-wrap items-center gap-2">
          {board.loadedAt !== null && <span className="num hidden text-xs text-muted sm:inline">{t('loadedAt', { time: formatTime(board.loadedAt, locale) })}</span>}
          <button
            type="button"
            data-testid="board-refresh"
            onClick={board.refresh}
            disabled={board.refreshing}
            className="inline-flex min-h-11 items-center gap-2 rounded border border-border px-4 text-sm text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${board.refreshing ? 'animate-spin' : ''}`} />
            {board.refreshing ? t('refreshing') : t('refresh')}
          </button>
        </div>
      </div>

      {(stale || connection === 'offline') && alertsOn && (
        <FormAlert tone="warning">
          <span data-testid="board-stale">{t('stale')}</span>
        </FormAlert>
      )}
      {!alertsOn && alerts.status !== 'loading' && (
        <FormAlert tone="info">
          <p data-testid="board-alerts-off" className="font-medium text-text">{t('alertsOffTitle')}</p>
          <p className="mt-1 text-muted">{t('alertsOffBody')}</p>
        </FormAlert>
      )}
      {alertsOn && snapshot.mode === 'attention_only' && <p className="text-xs text-muted">{t('restrictedNote')}</p>}
      {alertsOn && (
        <p className="text-xs text-muted">
          {alertsText.t('reliabilityOn')} {alertsText.t('reliabilityLimits')}
        </p>
      )}

      {board.status === 'loading' ? (
        <LoadingState variant="cards" rows={3} />
      ) : board.status === 'error' ? (
        <ErrorState message={board.errorKind === 'network' ? t('networkError') : t('loadError')} onRetry={board.refresh} />
      ) : (
        <>
          {board.errorKind !== null && <FormAlert tone="warning">{t('staleBoard')}</FormAlert>}
          {board.truncated && (
            <p className="text-xs text-muted">
              {t('truncated')}{' '}
              <Link href="/commerce/orders" className="underline underline-offset-2 hover:text-primary">{t('open')}</Link>
            </p>
          )}

          <div role="tablist" aria-label={t('colsLabel')} className="flex gap-1 overflow-x-auto xl:hidden">
            {BOARD_COLUMNS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`board-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`board-col-${key}`}
                data-testid={`board-tab-${key}`}
                onClick={() => setTab(key)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${tab === key ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-primary-soft'}`}
              >
                {t(`col.${key}`)}
                <span className="num rounded bg-background px-1.5 text-xs">{groups[key].length}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-5">
            {BOARD_COLUMNS.map((key) => (
              <section
                key={key}
                id={`board-col-${key}`}
                role="tabpanel"
                aria-labelledby={`board-tab-${key}`}
                data-testid={`board-col-${key}`}
                className={`${tab === key ? 'block' : 'hidden'} min-w-0 xl:block`}
              >
                <h2 className="mb-2 hidden items-center justify-between text-sm font-semibold text-text xl:flex">
                  {t(`col.${key}`)}
                  <span className="num rounded bg-primary-soft px-1.5 text-xs text-primary">{groups[key].length}</span>
                </h2>
                {key === 'done' && <p className="mb-2 text-xs text-muted">{t('doneHint')}</p>}
                {groups[key].length === 0 ? (
                  <p className="rounded border border-dashed border-border p-4 text-center text-sm text-muted">{t('colEmpty')}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1" aria-label={t(`col.${key}`)}>
                    {groups[key].map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        locale={locale}
                        nowMs={now}
                        alertPending={pendingIds.has(order.id)}
                        acking={acking.has(order.id)}
                        ackFailed={ackFailed.has(order.id)}
                        onAcknowledge={(id) => void onAcknowledge(id)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
