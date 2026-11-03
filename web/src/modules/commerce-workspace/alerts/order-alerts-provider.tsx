'use client';

import type { ReactNode } from 'react';
import { OrderAlertsContext } from './alerts-context';
import { useOrderAlertsController } from './use-order-alerts';

/**
 * مزوّد حالة تنبيه الطلبات (COPS-H3-5): يملك **المثيل الوحيد** من منسّق التبويبات + محرّك الاستطلاع + حامل الصوت داخل غلاف التجارة، ويشاركه مع
 * جرس الترويسة (`OrderAlertCenter`) ومساحة الاستقبال (`/commerce/orders/live`). لا منطق إضافياً هنا — كل السلوك في `useOrderAlertsController` (H3-3/H3-4).
 */
export function OrderAlertsProvider({ children }: { children: ReactNode }) {
  const state = useOrderAlertsController(false);

  return <OrderAlertsContext.Provider value={state}>{children}</OrderAlertsContext.Provider>;
}
