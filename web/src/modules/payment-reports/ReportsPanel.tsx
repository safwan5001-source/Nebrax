'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Tabs } from '@/components/ui/tabs';
import { AgingView } from './AgingView';
import { DifferencesView } from './DifferencesView';
import { ReconciliationView } from './ReconciliationView';
import type { ReportTab } from './contract';

/** تقارير المقاصة (PAY-H3-03، الحد الأساسي، قراءة فقط): مطابقة 1170 · فروقات التسويات · أعمار الأرصدة حسب الفرع. */
export function ReportsPanel() {
  const t = useTranslations('paymentReports');
  const [tab, setTab] = useState<ReportTab>('reconciliation');

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">{t('panel_hint')}</p>
      <Tabs
        tabs={[
          { id: 'reconciliation', label: t('tab_reconciliation') },
          { id: 'differences', label: t('tab_differences') },
          { id: 'aging', label: t('tab_aging') },
        ]}
        value={tab}
        onChange={(id) => setTab(id as ReportTab)}
      />
      {tab === 'reconciliation' ? <ReconciliationView /> : tab === 'differences' ? <DifferencesView /> : <AgingView />}
      <p className="text-xs text-muted">{t('later_note')}</p>
    </div>
  );
}
