'use client';

import { useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { confirmDiscardUnsaved } from '../unsaved-registry';
import { loadSchedule, type ScheduleDocument } from './delivery-schedule';
import type { AdminFailure } from './admin-http';
import { failureText } from './failure-text';
import { flowersAdminT } from './messages';
import { ReadinessList } from './readiness-list';
import { ScheduleRulesPanel } from './schedule-rules-panel';
import { WindowsPanel } from './windows-panel';
import { BlockedDatesPanel } from './blocked-dates-panel';
import { todayInZone, groupBlocked } from './blocked-dates';
import { FulfillmentPanel } from './fulfillment-panel';
import { loadFulfillment, type FulfillmentDocument } from './fulfillment';

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; document: ScheduleDocument };

export const DELIVERY_TABS = ['rules', 'windows', 'blocked', 'fulfilment'] as const;
export type DeliveryTabId = (typeof DELIVERY_TABS)[number];

const isTab = (value: string | null): value is DeliveryTabId => (DELIVERY_TABS as readonly (string | null)[]).includes(value);

/** التبويب من `?tab=` (روابط عميقة من مركز الإعداد)؛ غير المعروف يسقط على القواعد. */
function initialTab(): DeliveryTabId {
  if (typeof window === 'undefined') return 'rules';
  const requested = new URLSearchParams(window.location.search).get('tab');

  return isTab(requested) ? requested : 'rules';
}

/**
 * FLOWERS-H2-2 — مساحة التوصيل لمتجرٍ واحد: تحمّل مستند الجدولة (قواعد + فترات + تواريخ محجوبة) مرةً واحدة
 * وتشاركه بين التبويبات؛ كل حفظ يُعيد المستند كاملاً من الخادم فتبقى كل الشاشات متسقة. شريط الجاهزية يعرض
 * الشروط الأساسية فقط — توفّر «يصل اليوم» الفعلي يحدده الخادم لكل منتج.
 * المُركِّب يمرّر `key={storeId}` فلا يعبر مستندُ متجرٍ إلى آخر.
 */
export function DeliveryWorkspace({ storeId, locale }: { storeId: string; locale: string | undefined }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // مخزن التنفيذ يُحمَّل بالتوازي وفشله لا يحجب الجدولة: يُعرض ناقصاً بدل أن يُخفي الشاشة.
  const [fulfillment, setFulfillment] = useState<FulfillmentDocument | null | 'loading'>('loading');
  const [tab, setTabState] = useState<DeliveryTabId>('rules');
  useEffect(() => setTabState(initialTab()), []);
  const setTab = (next: DeliveryTabId) => {
    if (next === tab) return;
    // الأزرار ليست روابط فلا يمرّ بها حارس التنقّل: نسأل قبل أن يُفكَّك تبويبٌ فيه مسوّدة غير محفوظة.
    if (!confirmDiscardUnsaved()) return;
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  };

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadSchedule(storeId).then((result) => {
      if (!current) return;
      setPhase(result.ok ? { kind: 'ready', document: result.data } : { kind: 'failed', failure: result });
    });
    return () => {
      current = false;
    };
  }, [storeId, attempt]);

  useEffect(() => {
    let current = true;
    setFulfillment('loading');
    void loadFulfillment(storeId).then((result) => {
      if (current) setFulfillment(result.ok ? result.data : null);
    });
    return () => {
      current = false;
    };
  }, [storeId, attempt]);

  if (phase.kind === 'loading') return <LoadingState variant="table" rows={5} label={t('loading')} />;
  if (phase.kind === 'failed') {
    return phase.failure.kind === 'forbidden' || phase.failure.kind === 'not_found' ? (
      <EmptyState icon={Truck} title={failureText(phase.failure, t, 'load')} />
    ) : (
      <ErrorState message={failureText(phase.failure, t, 'load')} retryLabel={t('retry')} onRetry={() => setAttempt((n) => n + 1)} />
    );
  }

  const { document } = phase;
  const activeWindows = document.slots.filter((slot) => slot.isActive).length;
  const upcomingBlocked = groupBlocked(document.blockedDates, todayInZone(document.settings.timezone)).upcoming.length;
  const setDocument = (next: ScheduleDocument) => setPhase({ kind: 'ready', document: next });

  return (
    <div className="space-y-5">
      <section aria-labelledby="sched-readiness-title" className="max-w-3xl space-y-2" data-schedule-readiness>
        <h2 id="sched-readiness-title" className="text-sm font-semibold text-text">
          {t('schedReadinessTitle')}
        </h2>
        <ReadinessList
          statusLabels={{ done: t('schedReadyDone'), missing: t('schedReadyMissing') }}
          items={[
            { key: 'enabled', done: document.settings.enabled, label: t('schedReadyEnabled') },
            {
              key: 'windows',
              done: activeWindows > 0,
              label: t('schedReadyWindows', { n: activeWindows }),
              action:
                activeWindows === 0 ? (
                  <button type="button" className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setTab('windows')}>
                    {t('schedReadyWindowsAdd')}
                  </button>
                ) : undefined,
            },
            ...(fulfillment !== 'loading' && fulfillment !== null
              ? [
                  {
                    key: 'warehouse',
                    done: fulfillment.current !== null && fulfillment.current.isActive,
                    label: t('schedReadyWarehouse'),
                    action:
                      fulfillment.current === null || !fulfillment.current.isActive ? (
                        <button type="button" className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setTab('fulfilment')}>
                          {t('schedReadyWarehouseAdd')}
                        </button>
                      ) : undefined,
                  },
                ]
              : []),
          ]}
        />
        <p className="text-xs leading-5 text-muted">{t('schedReadyNote')}</p>
      </section>

      <div className="space-y-4">
        <Tabs
          tabs={[
            { id: 'rules', label: t('schedTabRules') },
            { id: 'windows', label: t('winTab'), count: document.slots.length },
            { id: 'blocked', label: t('blkTab'), count: upcomingBlocked },
            { id: 'fulfilment', label: t('fulTab') },
          ]}
          value={tab}
          onChange={(id) => setTab(id as DeliveryTabId)}
        />
        <TabPanel id={tab}>
          {tab === 'rules' ? (
            <ScheduleRulesPanel storeId={storeId} locale={locale} settings={document.settings} onSaved={setDocument} />
          ) : tab === 'windows' ? (
            <WindowsPanel storeId={storeId} locale={locale} document={document} onDocument={setDocument} />
          ) : tab === 'blocked' ? (
            <BlockedDatesPanel storeId={storeId} locale={locale} document={document} onDocument={setDocument} />
          ) : fulfillment === 'loading' ? (
            <LoadingState variant="table" rows={3} label={t('loading')} />
          ) : fulfillment === null ? (
            <ErrorState message={t('loadFailed')} retryLabel={t('retry')} onRetry={() => setAttempt((n) => n + 1)} />
          ) : (
            <FulfillmentPanel storeId={storeId} locale={locale} document={fulfillment} onDocument={setFulfillment} />
          )}
        </TabPanel>
      </div>
    </div>
  );
}

