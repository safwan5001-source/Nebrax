'use client';

import { useCallback, useEffect, useState } from 'react';
import { IntegrationCenterLanding, type SummaryStatus } from '@/components/integrations/integration-center-landing';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import {
  DELIVERY_APPLICATION_KEY,
  DELIVERY_PERMISSION,
  deliverySummary,
  isApplicationHidden,
  PAYMENTS_PERMISSION,
  type DeliveryAccess,
  type DeliverySummary,
} from '@/lib/integration-center';
import { COMMUNICATIONS_PERMISSION } from '@/lib/communications-providers';
import { hasPermission } from '@/lib/permissions';

/**
 * مركز التكاملات — الإعدادات › التكاملات. INT-UX-1: صفحة الدخول فقط.
 *
 * بوابتان تعكسان شاشة منصات التوصيل القائمة نفسها (`invoices.view` وقدرة `sales.pos`).
 * الخادم يبقى السلطة (403/404)؛ الواجهة لا تطلب بياناً لا يحقّ للمستخدم قراءته.
 * لا تعدّل شيئاً: قراءات فقط، ولا اتصال بأي مزوّد.
 */
export default function IntegrationsPage() {
  const [access, setAccess] = useState<DeliveryAccess>('checking');
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [canOpenApplications, setCanOpenApplications] = useState(false);
  const [communicationsAllowed, setCommunicationsAllowed] = useState(false);
  const [paymentsAllowed, setPaymentsAllowed] = useState(false);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const user = currentUser();
    setCanOpenApplications(hasPermission(user?.permissions, user?.role, 'apps.view'));
    // كتالوج مزوّدي الاتصالات ثابت (لا طلب شبكة) فبوابته الصلاحية وحدها، مستقلةً عن بوابة منصات التوصيل.
    setCommunicationsAllowed(hasPermission(user?.permissions, user?.role, COMMUNICATIONS_PERMISSION));

    // بوابات الدفع: رابط تنقّل فقط (بلا طلب بيانات)، بوابته `payments.view` وحدها.
    setPaymentsAllowed(hasPermission(user?.permissions, user?.role, PAYMENTS_PERMISSION));

    // بلا صلاحية: لا طلب بيانات إطلاقاً.
    if (!hasPermission(user?.permissions, user?.role, DELIVERY_PERMISSION)) {
      setAccess('denied');
      return;
    }

    setSummaryStatus('loading');
    (async () => {
      // فشل جلب حالة القدرات لا يحجب شيئاً (كالشريط الجانبي): الخادم يحرس المسارات على أي حال.
      const navState = await api<unknown>('/applications/nav-state').catch(() => null);
      if (cancelled) return;
      if (isApplicationHidden(navState, DELIVERY_APPLICATION_KEY)) {
        setAccess('app_off');
        return;
      }
      setAccess('allowed');

      const [profiles, readiness] = await Promise.allSettled([
        api<unknown>('/delivery-platforms'),
        api<unknown>('/delivery-platforms/readiness'),
      ]);
      if (cancelled) return;

      const next = deliverySummary(
        profiles.status === 'fulfilled' ? profiles.value : null,
        readiness.status === 'fulfilled' ? readiness.value : null,
      );
      // قراءتان فاشلتان تماماً = خطأ صريح؛ وإلا تُعرض الأسطر القابلة للقراءة فقط.
      if (next.setUp === null && next.nativeAvailable === null) {
        setSummary(null);
        setSummaryStatus('error');
        return;
      }
      setSummary(next);
      setSummaryStatus('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <IntegrationCenterLanding
      access={access}
      summary={summary}
      summaryStatus={summaryStatus}
      canOpenApplications={canOpenApplications}
      communicationsAllowed={communicationsAllowed}
      paymentsAllowed={paymentsAllowed}
      onRetry={retry}
    />
  );
}
