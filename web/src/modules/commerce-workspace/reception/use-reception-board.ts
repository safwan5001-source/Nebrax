'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyOrdersError } from '../orders/contract';
import type { OrderSummary } from '../orders/contract';
import { fetchBoard } from './reception-api';

export type BoardStatus = 'loading' | 'ready' | 'error';

export interface ReceptionBoardState {
  status: BoardStatus;
  orders: OrderSummary[];
  truncated: boolean;
  errorKind: ReturnType<typeof classifyOrdersError> | null;
  refreshing: boolean;
  loadedAt: number | null;
  refresh: () => void;
}

/** مهلة دمج إشارات التغيّر المتتالية (حدث تغذية ثم بصمة انتباه) في جلب واحد. */
export const REVISION_DEBOUNCE_MS = 400;

/**
 * يحمّل لوحة الاستقبال **عند الطلب فقط**: تركيب الصفحة، تغيّر `revision` اللقطة المشتركة (مدموجاً بمهلة قصيرة)، التحديث اليدوي، وبعد إجراء.
 * لا مؤقّت دوري ولا استطلاع (اللقطة المشتركة هي الاستطلاع الوحيد — COPS-H3-5). استجابة أقدم من أحدث طلب تُهمَل، ولا طلبان متوازيان
 * (طلب أثناء الطيران يُسجَّل ويُنفَّذ مرة واحدة بعده). فشل التحديث يُبقي آخر بيانات جيدة ويُظهر الخطأ.
 */
export function useReceptionBoard({ storefrontId, enabled, revision }: { storefrontId: string | null; enabled: boolean; revision: number }): ReceptionBoardState {
  const [status, setStatus] = useState<BoardStatus>('loading');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [errorKind, setErrorKind] = useState<ReceptionBoardState['errorKind']>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const generation = useRef(0);
  const storefrontRef = useRef(storefrontId);
  storefrontRef.current = storefrontId;

  const load = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;

      return;
    }
    inFlight.current = true;
    const mine = generation.current;
    setRefreshing(true);
    try {
      const data = await fetchBoard(storefrontRef.current);
      if (mine !== generation.current) return;
      setOrders(data.orders);
      setTruncated(data.truncated);
      setErrorKind(null);
      setStatus('ready');
      setLoadedAt(Date.now());
    } catch (error) {
      if (mine !== generation.current) return;
      setErrorKind(classifyOrdersError(error));
      setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    } finally {
      if (mine === generation.current) {
        inFlight.current = false;
        setRefreshing(false);
        if (again.current) {
          again.current = false;
          void load();
        }
      }
    }
  }, []);

  // تغيّر المتجر/تفعيل الصفحة ⇒ جيل جديد ولوحة جديدة (لا خلط بين متجرين).
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    again.current = false;
    setOrders([]);
    setStatus('loading');
    setErrorKind(null);
    if (!enabled) return;
    void load();
  }, [storefrontId, enabled, load]);

  // إشارة التغيّر من اللقطة المشتركة (لا استطلاع إضافي).
  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) {
      firstRevision.current = false;

      return;
    }
    if (!enabled) return;
    const timer = setTimeout(() => void load(), REVISION_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [revision, enabled, load]);

  const refresh = useCallback(() => void load(), [load]);

  return { status, orders, truncated, errorKind, refreshing, loadedAt, refresh };
}
