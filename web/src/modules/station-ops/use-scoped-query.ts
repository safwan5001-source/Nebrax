'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbort, toStationOpsError, type StationOpsError } from './read-client';

/**
 * UI-0 — استعلام مقيَّد بمفتاح نطاق، بلا ذاكرة مشتركة بين المفاتيح.
 *
 * الضمانات (تحرسها اختبارات `use-scoped-query.test.tsx`):
 * 1. **لا تسرّب**: النتيجة المعروضة تخص `key` الحالي فقط. بعد تبديل المفتاح (محطة/فرع/مستأجر) يُعاد `loading`
 *    في الإطار نفسه — قبل أن يعمل أي تأثير — فلا يظهر لإطار واحد محتوى المحطة السابقة.
 * 2. **لا سباق**: كل تشغيل يملك `AbortController`؛ تبديل المفتاح أو إزالة المكوّن يلغي الطلب، وأي ردّ متأخر
 *    لمفتاح سابق يُهمل حتى لو لم يحترم الطلب الإلغاء.
 * 3. **لا cache عابر للمفاتيح**: الحالة لمفتاح واحد في كل لحظة؛ العودة لمحطة سابقة تعيد الجلب.
 */

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: StationOpsError };

const LOADING: QueryState<never> = { status: 'loading' };

export interface ScopedQuery<T> {
  state: QueryState<T>;
  reload: () => void;
}

export function useScopedQuery<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): ScopedQuery<T> {
  const [held, setHeld] = useState<{ key: string | null; value: QueryState<T> }>({ key: null, value: LOADING });
  const [attempt, setAttempt] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    let live = true;
    setHeld({ key, value: LOADING });
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (live) setHeld({ key, value: { status: 'success', data } });
      },
      (error: unknown) => {
        if (!live || isAbort(error)) return;
        setHeld({ key, value: { status: 'error', error: toStationOpsError(error) } });
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const state: QueryState<T> = key !== null && held.key === key ? held.value : LOADING;
  return { state, reload };
}
