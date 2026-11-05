'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { PricesError } from './client';

export type LoaderState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: PricesError };

interface Held<T> { key: string | null; state: LoaderState<T> }

type Action<T> = { type: 'start'; key: string | null } | { type: 'done'; key: string | null; state: LoaderState<T> };

function reducer<T>(held: Held<T>, action: Action<T>): Held<T> {
  if (action.type === 'start') return { key: action.key, state: { status: 'loading' } };
  // رد متأخر لمفتاح سابق لا يُكتب فوق المفتاح الحالي.
  return action.key === held.key ? { key: held.key, state: action.state } : held;
}

/**
 * قراءة مرتبطة بمفتاح واحد: تغيّر المفتاح (مستأجر/مستخدم/نطاق) يعرض `loading` فوراً — لا بيانات نطاق سابق ولا cache عابر —
 * ويُلغي الطلب السابق ويتجاهل ردّه المتأخر. `key = null` ⇒ لا طلب (يبقى `loading`؛ على المستدعي ألّا يعرضه).
 */
export function useLoader<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): { state: LoaderState<T>; reload: () => void; refresh: () => void } {
  const [held, dispatch] = useReducer(reducer<T>, { key, state: { status: 'loading' } } as Held<T>);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const run = useCallback((k: string | null) => {
    if (k === null) return () => {};
    const controller = new AbortController();
    const mine = ++generation.current;
    dispatch({ type: 'start', key: k });
    loadRef.current(controller.signal)
      .then((data) => { if (generation.current === mine) dispatch({ type: 'done', key: k, state: { status: 'success', data } }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== mine) return;
        dispatch({ type: 'done', key: k, state: { status: 'error', error: error instanceof PricesError ? error : new PricesError('offline') } });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => run(key), [key, run]);

  /**
   * تحديث صامت: لا ينقل إلى `loading` (بلا وميض هيكل) ويُبقي القيمة الحالية، ويستبدلها عند النجاح فقط؛ فشله يُتجاهل ولا يمسح
   * بياناً صالحاً. لمراجعة تغيّرات تسري بمرور الوقت (سعر مجدول بدأ سريانه) دون تدخل المستخدم.
   */
  const refresh = useCallback(() => {
    if (key === null) return;
    const mine = ++generation.current;
    loadRef.current(new AbortController().signal)
      .then((data) => { if (generation.current === mine) dispatch({ type: 'done', key, state: { status: 'success', data } }); })
      .catch(() => {});
  }, [key]);

  // مفتاح تغيّر ولم يصل effect بعد: لا نعرض حالة المفتاح السابق ولو لإطار واحد.
  const state: LoaderState<T> = held.key === key ? held.state : { status: 'loading' };
  return { state, reload: () => { run(key); }, refresh };
}
