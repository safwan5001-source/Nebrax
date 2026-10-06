'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadVerticalSetup, type VerticalSetup } from '@/modules/commerce-workspace/vertical-setup';
import { loadSchedule, type ScheduleDocument } from '../delivery-schedule';
import { loadFulfillment, type FulfillmentDocument } from '../fulfillment';
import { loadGiftPolicy, type GiftPolicy } from '../gift-settings';
import { deriveSetupSteps, type SetupStep } from './derive';

export type SetupState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; vertical: string; steps: SetupStep[] };

/**
 * يقرأ حالة الإعداد الحقيقية لمتجر: `vertical-setup` (الخادم يشتقّ الحالة) + مستندات الإدارة الثلاثة لتفسير النقص.
 * فشل `vertical-setup` فشلٌ للشاشة (نعرض إعادة المحاولة)؛ فشل أي مستند آخر لا يحجب: يُعرض بلا تفسير إضافي.
 * استجابة متجرٍ سابق تُهمَل. `reload()` يعيد القراءة بعد أي كتابة (مثل القيم المبدئية).
 */
export function useSetupState(storeId: string): { state: SetupState; reload: () => void } {
  const [state, setState] = useState<SetupState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState((existing) => (existing.kind === 'ready' ? existing : { kind: 'loading' }));
    void (async () => {
      const [setup, gift, schedule, fulfillment] = await Promise.all([
        loadVerticalSetup(storeId),
        loadGiftPolicy(storeId),
        loadSchedule(storeId),
        loadFulfillment(storeId),
      ]);
      if (!current) return;
      if (!setup) {
        setState({ kind: 'failed' });
        return;
      }
      const inputs: { setup: VerticalSetup; gift: GiftPolicy | null; schedule: ScheduleDocument | null; fulfillment: FulfillmentDocument | null } = {
        setup,
        gift: gift.ok ? gift.data : null,
        schedule: schedule.ok ? schedule.data : null,
        fulfillment: fulfillment.ok ? fulfillment.data : null,
      };
      setState({ kind: 'ready', vertical: setup.vertical, steps: deriveSetupSteps(inputs) });
    })();

    return () => {
      current = false;
    };
  }, [storeId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload };
}
