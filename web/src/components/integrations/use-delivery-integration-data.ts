'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import {
  DELIVERY_APPLICATION_KEY,
  DELIVERY_CONNECTOR_VIEW_PERMISSION,
  DELIVERY_PERMISSION,
  DELIVERY_REPORT_PERMISSION,
  HUB_VIEW_PERMISSION,
  isApplicationHidden,
  nativeStatusOf,
  readManualStatuses,
  readReadinessRows,
  type DeliveryAccess,
  type ReadinessRow,
} from '@/lib/integration-center';
import { hasPermission } from '@/lib/permissions';

export interface DeliveryIntegrationData {
  access: DeliveryAccess;
  /** `loading` حتى تنتهي القراءتان؛ بعدها `ready` (حتى لو فشلت إحداهما — انظر العلمين). */
  status: 'loading' | 'ready';
  manual: Map<string, 'set' | 'disabled'> | null;
  readiness: Map<string, ReadinessRow> | null;
  manualFailed: boolean;
  readinessFailed: boolean;
  canOpenApplications: boolean;
  canViewHub: boolean;
  canViewReport: boolean;
  /** يرسل الخادم الحقول الداخلية لمن يملك `delivery_connector.view` وحده؛ الواجهة تعرض ما وصلها فقط. */
  canViewEvidence: boolean;
  retry: () => void;
}

/**
 * قراءة بيانات كتالوج منصات التوصيل وتفاصيلها (INT-UX-2) — قراءتان قائمتان فقط:
 * `GET /delivery-platforms` (الإسناد اليدوي) و`GET /delivery-platforms/readiness` (الجاهزية).
 * بلا صلاحية `invoices.view` لا يُرسَل أي طلب؛ وقدرة `sales.pos` المعطّلة توقف القراءة بعد
 * نداء حالة القدرات الواحد. الخادم يبقى السلطة (403/404)، والواجهة لا تفترض نجاحاً.
 * `enabled=false` (مفتاح منصة غير معروف) = صفر طلبات.
 */
export function useDeliveryIntegrationData(enabled = true): DeliveryIntegrationData {
  const [access, setAccess] = useState<DeliveryAccess>('checking');
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [manual, setManual] = useState<Map<string, 'set' | 'disabled'> | null>(null);
  const [readiness, setReadiness] = useState<Map<string, ReadinessRow> | null>(null);
  const [manualFailed, setManualFailed] = useState(false);
  const [readinessFailed, setReadinessFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [perms, setPerms] = useState({ apps: false, hub: false, report: false, evidence: false });

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const user = currentUser();
    setPerms({
      apps: hasPermission(user?.permissions, user?.role, 'apps.view'),
      hub: hasPermission(user?.permissions, user?.role, HUB_VIEW_PERMISSION),
      report: hasPermission(user?.permissions, user?.role, DELIVERY_REPORT_PERMISSION),
      evidence: hasPermission(user?.permissions, user?.role, DELIVERY_CONNECTOR_VIEW_PERMISSION),
    });

    if (!hasPermission(user?.permissions, user?.role, DELIVERY_PERMISSION)) {
      setAccess('denied');
      setStatus('ready');
      return;
    }

    setStatus('loading');
    (async () => {
      // فشل جلب حالة القدرات لا يحجب شيئاً (كالشريط الجانبي): الخادم يحرس المسارات.
      const navState = await api<unknown>('/applications/nav-state').catch(() => null);
      if (cancelled) return;
      if (isApplicationHidden(navState, DELIVERY_APPLICATION_KEY)) {
        setAccess('app_off');
        setStatus('ready');
        return;
      }
      setAccess('allowed');

      const [profiles, readinessResult] = await Promise.allSettled([
        api<unknown>('/delivery-platforms'),
        api<unknown>('/delivery-platforms/readiness'),
      ]);
      if (cancelled) return;

      const manualRead = profiles.status === 'fulfilled' ? readManualStatuses(profiles.value) : null;
      const readinessRead = readinessResult.status === 'fulfilled' ? readReadinessRows(readinessResult.value) : null;
      setManual(manualRead);
      setReadiness(readinessRead);
      setManualFailed(manualRead === null);
      // صف متناقض أو بحالة لا نعرفها يبقى «تعذّرت القراءة» لمنصته فقط، لكن يظهر معه إشعار الفشل وإعادة المحاولة.
      setReadinessFailed(readinessRead === null || [...readinessRead.values()].some((row) => nativeStatusOf(row) === 'unreadable'));
      setStatus('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, enabled]);

  return {
    access: enabled ? access : 'checking',
    status: enabled ? status : 'ready',
    manual,
    readiness,
    manualFailed,
    readinessFailed,
    canOpenApplications: perms.apps,
    canViewHub: perms.hub,
    canViewReport: perms.report,
    canViewEvidence: perms.evidence,
    retry,
  };
}
