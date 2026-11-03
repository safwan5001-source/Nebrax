'use client';

import { createContext } from 'react';
import type { OrderAlertsState } from './use-order-alerts';

/** COPS-H3-5 — سياق حالة التنبيه المشتركة. `null` = لا مزوّد (المستهلك يبني مثيلاً خاصاً به). */
export const OrderAlertsContext = createContext<OrderAlertsState | null>(null);
