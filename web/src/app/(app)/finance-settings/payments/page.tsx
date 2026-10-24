'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { isDemo } from '@/lib/demo';
import { useCan } from '@/lib/use-can';
import { GatewaysPanel } from '@/modules/payments/gateways/GatewaysPanel';
import { MANAGE_PERMISSION, VIEW_PERMISSION } from '@/modules/payments/gateways/contract';
import { OnlineMethodsPanel } from '@/modules/payments/methods/OnlineMethodsPanel';

type TabId = 'methods' | 'gateways';

function parseTab(value: string | null | undefined): TabId {
  return value === 'gateways' ? 'gateways' : 'methods';
}

/**
 * الإعدادات › المالية › المدفوعات (PAY-SETTINGS-UX): صفحة موحّدة بتبويبين — «وسائل الدفع» (ما يراه العميل) و«بوابات الدفع» (الاتصالات والإعدادات التقنية).
 * مصدر حقيقة واحد: الاتصالات في `/payment-gateways` وجاهزية الوسائل محسوبة منها في `/online-payment-methods`؛ لا مفاتيح ولا إعدادات مكرّرة بين التبويبين.
 * القراءة `payments.view`، والتعديل `payment_gateways.manage`؛ الخادم هو الحاسم. التبويب في الرابط (`?tab=`) ليبقى قابلاً للمشاركة وللرجوع.
 */
export default function PaymentSettingsPage() {
  const t = useTranslations('paymentGateways');
  const tp = useTranslations('paymentSettings');
  const searchParams = useSearchParams();
  const { can, hydrated } = useCan();
  const canView = can(VIEW_PERMISSION);
  // وضع المعاينة بلا خادم: لا يُحاكي هذا المسار، فتُعطَّل الإجراءات بدل نجاحٍ كاذب.
  const [demo, setDemo] = useState(false);
  useEffect(() => setDemo(isDemo()), []);
  const canManage = can(MANAGE_PERMISSION) && !demo;

  const [tab, setTab] = useState<TabId>(() => parseTab(searchParams?.get('tab')));
  const [refreshKey, setRefreshKey] = useState(0);

  const select = useCallback((id: string) => {
    const next = parseTab(id);
    setTab(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, []);

  if (hydrated && !canView) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Header title={tp('title')} subtitle={tp('subtitle')} back={t('back')} />
        <p role="note" className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="pg-denied">{t('denied')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Header title={tp('title')} subtitle={tp('subtitle')} back={t('back')} />
      <Tabs
        value={tab}
        onChange={select}
        tabs={[
          { id: 'methods', label: tp('tabMethods') },
          { id: 'gateways', label: tp('tabGateways') },
        ]}
      />
      {!hydrated ? null : tab === 'methods' ? (
        <TabPanel id="methods">
          <OnlineMethodsPanel canManage={canManage} refreshKey={refreshKey} onOpenGateways={() => select('gateways')} />
        </TabPanel>
      ) : (
        <TabPanel id="gateways">
          <GatewaysPanel canManage={canManage} demo={demo} onChanged={() => setRefreshKey((n) => n + 1)} />
        </TabPanel>
      )}
    </div>
  );
}

function Header({ title, subtitle, back }: { title: string; subtitle: string; back: string }) {
  return (
    <div className="flex items-center gap-3">
      <Button asChild variant="ghost" size="icon" aria-label={back}>
        <Link href="/finance-settings"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} /></Link>
      </Button>
      <div>
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
