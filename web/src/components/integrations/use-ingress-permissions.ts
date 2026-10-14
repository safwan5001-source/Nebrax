'use client';

import { useMemo } from 'react';
import { currentUser } from '@/lib/auth';
import { ingressActionAvailability, type IngressActionAvailability } from '@/lib/ingress-management';

/**
 * هيكل صلاحيات إدارة نقاط الاستقبال (INT-UX-5a): يحسب ما يحق للمستخدم الحالي رؤيته من إجراءات لنقطة معيّنة
 * من قائمة صلاحيات الخادم. **لا يطلب شيئاً من الشبكة ولا يُنفّذ إجراءً ولا يُوصَل بأي شاشة بعد** — 5b/5c/5d
 * هي من تستهلكه. الخادم يبقى السلطة (403/404)؛ هذا قرار عرض فقط.
 */
export function useIngressPermissions(point: { status: 'configured' | 'disabled' } | null): IngressActionAvailability {
  const status = point?.status ?? null;
  return useMemo(() => {
    const user = currentUser();
    return ingressActionAvailability(user?.permissions, user?.role, status === null ? null : { status });
  }, [status]);
}
