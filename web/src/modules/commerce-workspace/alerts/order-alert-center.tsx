'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { BellRing, Volume2, VolumeX } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { formatDateTime } from '@/lib/formatting';
import { isStale } from './alert-engine';
import { alertMessages } from './messages';
import { useOrderAlerts } from './use-order-alerts';

/**
 * مركز تنبيه طلبات المتجر في ترويسة غلاف التجارة (COPS-H3-3). يعرض فقط ما يحكم به الخادم (`alert.pending`) ولا يملك منطق حالة.
 * بوابة مغلقة/صلاحية غائبة ⇒ لا يُعرض شيء ولا يبدأ استطلاع. النصوص ملزمة (ADR-30 §5.3): لا وعد بالخلفية أو الجوال المقفل.
 */
export function OrderAlertCenter() {
  const locale = useLocale();
  const { t, reason } = alertMessages(locale);
  const alerts = useOrderAlerts();
  const [now, setNow] = useState(() => Date.now());
  const [testFailed, setTestFailed] = useState(false);

  useEffect(() => {
    if (alerts.status !== 'on') return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);

    return () => window.clearInterval(timer);
  }, [alerts.status]);

  if (alerts.status !== 'on') return null;

  const { snapshot } = alerts;
  const pendingCount = snapshot.pending.length;
  const stale = isStale(snapshot, now);
  const connection = stale && snapshot.connection === 'live' ? 'degraded' : snapshot.connection;
  const statusText = {
    idle: t('statusConnecting'),
    connecting: t('statusConnecting'),
    live: t('statusLive'),
    degraded: t('statusDegraded'),
    offline: t('statusOffline'),
  }[connection];
  const dotClass = connection === 'live' ? 'bg-positive' : connection === 'offline' || connection === 'degraded' ? 'bg-negative' : 'bg-muted';
  const seconds = snapshot.lastSuccessAt === null ? null : Math.max(0, Math.round((now - snapshot.lastSuccessAt) / 1000));
  const soundArmed = alerts.soundState === 'armed';

  async function onTest() {
    setTestFailed(false);
    const ok = await alerts.testSound();
    if (!ok) setTestFailed(true);
  }

  return (
    <>
      <Dropdown
        align="end"
        mobilePopover
        popupRole="dialog"
        menuLabel={t('panelTitle')}
        triggerLabel={pendingCount > 0 ? t('bellLabelPending') : t('bellLabel')}
        triggerClassName="relative h-11 w-11 justify-center text-text hover:bg-primary-soft hover:text-primary"
        menuClassName="w-[min(24rem,calc(100vw-1.5rem))] p-0 lg:w-[24rem]"
        trigger={
          <>
            <BellRing className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            <span aria-hidden="true" data-testid="alert-status-dot" className={`absolute bottom-1.5 end-1.5 h-2 w-2 rounded-full ${dotClass}`} />
            {pendingCount > 0 && (
              <span
                data-testid="alert-badge"
                aria-hidden="true"
                className="num absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-none text-white"
              >
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </>
        }
      >
        <div data-testid="alert-panel" className="flex max-h-[70vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-semibold text-text">{t('panelTitle')}</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
              {statusText}
              {seconds !== null && connection === 'live' ? <span className="num"> · {t('lastUpdate', { seconds })}</span> : null}
            </span>
          </div>

          {(stale || connection === 'offline') && (
            <p data-testid="alert-stale" role="alert" className="border-b border-border bg-warning-soft px-3 py-2 text-xs text-text">
              {t('stale')}
            </p>
          )}

          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-label={t('panelTitle')}>
            {pendingCount === 0 ? (
              <li className="px-3 py-6 text-center">
                <p className="text-sm font-medium text-text">{t('emptyTitle')}</p>
                <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
              </li>
            ) : (
              snapshot.pending.map((item) => (
                <li key={item.orderId} data-testid="alert-item" className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num font-medium text-text" dir="ltr">{item.number ?? item.orderId.slice(0, 8)}</span>
                    <span className="text-xs text-muted">{formatDateTime(item.createdAt, locale)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.reasons.map((r) => (
                      <span key={r} className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary">{reason(r)}</span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/commerce/orders/${item.orderId}`}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded bg-primary px-3 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {t('open')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => alerts.silence(item.orderId)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded border border-border px-3 text-sm text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {t('silence')}
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>

          {snapshot.truncated && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted">{t('truncated')}</p>
          )}

          <div className="space-y-2 border-t border-border px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                {soundArmed ? <Volume2 aria-hidden="true" className="h-3.5 w-3.5" /> : <VolumeX aria-hidden="true" className="h-3.5 w-3.5" />}
                {soundArmed ? t('soundOn') : t('soundOff')}
              </span>
              {!soundArmed && (
                <button type="button" onClick={() => void alerts.enableSound()} className="inline-flex min-h-11 items-center rounded bg-primary px-3 text-sm font-medium text-white hover:opacity-90">
                  {t('soundEnable')}
                </button>
              )}
              <button type="button" onClick={() => void onTest()} className="inline-flex min-h-11 items-center rounded border border-border px-3 text-sm text-text hover:bg-primary-soft">
                {t('soundTest')}
              </button>
            </div>
            {testFailed && <p role="alert" className="text-xs text-negative">{t('soundTestFailed')}</p>}
            {soundArmed && !alerts.soundOwner && <p className="text-xs text-muted">{t('soundOwnerOther')}</p>}
            {snapshot.mode === 'attention_only' && <p className="text-xs text-muted">{t('warehouseScoped')}</p>}
            <p className="text-xs text-muted">{t('reliabilityOn')}</p>
            <p className="text-xs text-muted">{t('reliabilityLimits')}</p>
          </div>
        </div>
      </Dropdown>

      {!soundArmed && (
        <div
          data-testid="alert-sound-bar"
          role="region"
          aria-label={t('soundOff')}
          className="no-print fixed inset-x-3 bottom-3 z-40 flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 shadow-lg sm:inset-x-auto sm:end-4 sm:max-w-md"
        >
          <span className="text-sm text-text">{t('soundBarText')}</span>
          <button type="button" onClick={() => void alerts.enableSound()} className="inline-flex min-h-11 items-center rounded bg-primary px-3 text-sm font-medium text-white hover:opacity-90">
            {t('soundEnable')}
          </button>
        </div>
      )}
    </>
  );
}
