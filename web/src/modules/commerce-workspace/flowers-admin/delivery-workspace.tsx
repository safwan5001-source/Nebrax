'use client';

import { useEffect, useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { loadSchedule, type ScheduleDocument } from './delivery-schedule';
import type { AdminFailure } from './admin-http';
import { failureText } from './failure-text';
import { flowersAdminT } from './messages';
import { ReadinessList } from './readiness-list';
import { ScheduleRulesPanel } from './schedule-rules-panel';

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; document: ScheduleDocument };

export type DeliveryTabId = 'rules';

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
  const [tab, setTab] = useState<DeliveryTabId>('rules');

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
            { key: 'windows', done: activeWindows > 0, label: t('schedReadyWindows', { n: activeWindows }) },
          ]}
        />
        <p className="text-xs leading-5 text-muted">{t('schedReadyNote')}</p>
      </section>

      <div className="space-y-4">
        {/* تبويب واحد في هذه الخطوة: لا شريط تبويبات يوحي بما لم يُبنَ بعد، فلا دلالات tabpanel يتيمة. */}
        <div data-delivery-panel={tab}>
          <ScheduleRulesPanel storeId={storeId} locale={locale} settings={document.settings} onSaved={setDocument} />
        </div>
      </div>
    </div>
  );
}

